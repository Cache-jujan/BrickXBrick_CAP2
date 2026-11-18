// When the Project Manager swaps a project's Site Manager, the General Manager
// is told who the new one is. When the GM does it, the GM is not told.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const state = { sent: [], gmNotices: [] };
let currentUser = { id: "pm-1", name: "marco.project-manager", role: "Project Manager" };

const projectRow = () => ({
  projectid: PROJECT_ID, name: "Consolacion Residence", status: "Active",
  projectmanagerid: "pm-1", sitemanagerid: "sm-old", budget: "0",
  sitemanagername: "ana.site-manager", sitemanageremail: "ana@gmail.com",
});

async function fakeQuery(sql) {
  const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
  if (text.startsWith("select userid from users where role = 'general manager'")) {
    return { rowCount: 2, rows: [{ userid: "gm-1" }, { userid: "gm-2" }] };
  }
  if (text.startsWith("insert into notifications")) {
    state.gmNotices.push(arguments[1]);
    return { rowCount: 1, rows: [] };
  }
  if (text.startsWith("update projects set sitemanagerid")) return { rowCount: 1, rows: [projectRow()] };
  if (text.startsWith("select") && text.includes("from projects where projectid")) return { rowCount: 1, rows: [projectRow()] };
  return { rowCount: 0, rows: [] };
}

const realRules = require("../src/lib/projectRules");
stub("../src/lib/db", { query: fakeQuery, withTransaction: async (fn) => fn({ query: fakeQuery }) });
stub("../src/middleware/auth", { requireAuth: (req, _res, next) => { req.user = currentUser; next(); } });
stub("../src/lib/reassignSiteManager", { reassignSiteManager: async () => {} });
stub("../src/lib/projectRules", {
  ...realRules,
  loadProjectSettings: async () => ({ ...realRules.DEFAULT_SETTINGS }),
  assertManagerAvailable: async () => {},
  notifyProject: async (_client, n) => { state.sent.push(n); },
});

const projectsRouter = require("../src/routes/projects");

async function swap(user) {
  currentUser = user;
  state.sent = [];
  state.gmNotices = [];
  const app = express();
  app.use(express.json());
  app.use("/api/projects", projectsRouter);
  const server = await new Promise((r) => { const s = http.createServer(app).listen(0, () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${PROJECT_ID}/site-manager`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteManagerId: "sm-new" }),
    });
    return res.status;
  } finally {
    server.close();
  }
}

test("a PM swapping the Site Manager tells the new one and every General Manager", async () => {
  assert.equal(await swap({ id: "pm-1", name: "marco.project-manager", role: "Project Manager" }), 200);
  assert.deepEqual(state.sent.map((n) => n.recipientId), ["sm-new"]);
  assert.deepEqual(state.gmNotices.map((p) => p[0]).sort(), ["gm-1", "gm-2"]);
  const [, type, entityType, , message] = state.gmNotices[0];
  assert.equal(type, "ProjectAssigned");
  assert.equal(entityType, "Project");
  assert.match(message, /marco\.project-manager changed the Site Manager of "Consolacion Residence" to ana\.site-manager/);
});

test("a GM swapping the Site Manager does not notify General Managers", async () => {
  assert.equal(await swap({ id: "gm-1", name: "lea.general-manager", role: "General Manager" }), 200);
  assert.deepEqual(state.sent.map((n) => n.recipientId), ["sm-new"]);
  assert.equal(state.gmNotices.length, 0);
});
