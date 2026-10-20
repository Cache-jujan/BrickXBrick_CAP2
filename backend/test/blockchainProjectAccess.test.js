// F12 — a Project Manager can only read the blockchain section of their own
// projects (adviser audit S2).
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const state = { me: null, owner: "pm-1", exists: true };
stub("../src/lib/db", {
  query: async (sql) => {
    const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
    if (text.startsWith("select projectmanagerid from projects")) {
      return state.exists ? { rowCount: 1, rows: [{ projectmanagerid: state.owner }] } : { rowCount: 0, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  },
});
stub("../src/middleware/auth", { requireAuth: (req, _res, next) => { req.user = state.me; next(); } });
stub("../src/lib/tamperAlerts", { resolveTamperAlert: async () => ({}) });
stub("../src/lib/integrityCheck", { checkExpenseIntegrity: async () => ({}) });

const router = require("../src/routes/blockchain");

async function get(me, over = {}) {
  state.me = me;
  state.exists = over.exists ?? true;
  const app = express();
  app.use("/api/blockchain", router);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const server = await new Promise((r) => { const s = http.createServer(app).listen(0, () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/blockchain/project/11111111-1111-4111-8111-111111111111`);
    return res.status;
  } finally { server.close(); }
}

test("the PM who manages the project can read it", async () => {
  assert.equal(await get({ id: "pm-1", role: "Project Manager" }), 200);
});

test("another PM is refused", async () => {
  assert.equal(await get({ id: "pm-2", role: "Project Manager" }), 403);
});

test("the General Manager can read any project", async () => {
  assert.equal(await get({ id: "gm", role: "General Manager" }), 200);
});

test("an unknown project is a 404", async () => {
  assert.equal(await get({ id: "gm", role: "General Manager" }, { exists: false }), 404);
});

test("a Site Manager is refused by role", async () => {
  assert.equal(await get({ id: "sm", role: "Site Manager" }), 403);
});
