// F2 — the owning Project Manager sees the BOM only once the General Manager
// has approved it. A Draft (including one reopened for revision) is the GM's
// working copy; its figures can still change and the client has not agreed yet.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const state = { me: null, bomStatus: "Draft", hasBom: true };

async function fakeQuery(sql) {
  const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
  if (text.includes("from projects")) {
    return {
      rowCount: 1,
      rows: [{ projectid: PROJECT_ID, name: "Sample", status: "Draft", budget: "30000000", projectmanagerid: "pm-1", sitemanagerid: null, constructionstartdate: null }],
    };
  }
  if (text.includes("from boms b")) {
    if (!state.hasBom) return { rowCount: 0, rows: [] };
    return {
      rowCount: 1,
      rows: [{ bomid: "bom-1", status: state.bomStatus, statedtotal: "1000", escalationrate: "0.05", sourcefilename: "x.xlsx" }],
    };
  }
  return { rowCount: 0, rows: [] };
}

stub("../src/lib/db", { query: fakeQuery, withTransaction: async (fn) => fn({ query: fakeQuery }) });
stub("../src/middleware/auth", {
  requireAuth: (req, _res, next) => {
    req.user = state.me;
    next();
  },
});
const bomRouter = require("../src/routes/bom");

async function getBom() {
  const app = express();
  app.use("/api/projects/:projectId/bom", bomRouter);
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${PROJECT_ID}/bom`);
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

const PM = { id: "pm-1", role: "Project Manager" };
const GM = { id: "gm-1", role: "General Manager" };

test("the PM gets no figures while the BOM is a Draft", async () => {
  Object.assign(state, { me: PM, bomStatus: "Draft", hasBom: true });
  const res = await getBom();
  assert.equal(res.status, 200);
  assert.equal(res.body.bom, null);
  assert.equal(res.body.bomPending, true);
  assert.equal(JSON.stringify(res.body).includes("escalation"), false, "no budget breakdown leaks");
});

test("the PM sees the BOM once it is approved", async () => {
  Object.assign(state, { me: PM, bomStatus: "Approved", hasBom: true });
  const res = await getBom();
  assert.equal(res.status, 200);
  assert.equal(res.body.bom.status, "Approved");
  assert.equal(res.body.bomPending, undefined);
});

test("a BOM reopened for revision is hidden from the PM again", async () => {
  Object.assign(state, { me: PM, bomStatus: "Draft", hasBom: true });
  assert.equal((await getBom()).body.bomPending, true);
});

test("no BOM at all is not reported as pending", async () => {
  Object.assign(state, { me: PM, hasBom: false });
  const res = await getBom();
  assert.equal(res.body.bom, null);
  assert.equal(res.body.bomPending, undefined);
});

test("the General Manager always sees the Draft", async () => {
  Object.assign(state, { me: GM, bomStatus: "Draft", hasBom: true });
  const res = await getBom();
  assert.equal(res.body.bom.status, "Draft");
  assert.equal(res.body.bomPending, undefined);
});

test("a PM who does not own the project is still refused", async () => {
  Object.assign(state, { me: { id: "pm-2", role: "Project Manager" }, bomStatus: "Approved", hasBom: true });
  assert.equal((await getBom()).status, 403);
});
