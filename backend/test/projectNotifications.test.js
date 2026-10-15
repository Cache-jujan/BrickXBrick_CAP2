// F2 — "notify the PM and SM when a project is created" (adviser item 3).
//
// Every path that gives someone a project must send exactly one
// "ProjectAssigned" notification to that person, and clearing a manager
// sends none. The project routes run for real; only the database, auth and
// the manager-availability check are replaced, so no database is needed.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SM_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const notifications = [];
let stored = null; // the project row the fake database holds

function projectRow(overrides = {}) {
  return {
    projectid: PROJECT_ID,
    name: "Consolacion Two-Storey Residence",
    clientname: "Sample Client",
    status: "Draft",
    startdate: "2026-11-02",
    constructionstartdate: "2027-01-11",
    enddate: "2027-06-30",
    projecttype: "Residential Building",
    municipality: "Consolacion",
    budget: "0",
    projectmanagerid: PM_A,
    sitemanagerid: null,
    ...overrides,
  };
}

async function fakeQuery(sql, params = []) {
  const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
  if (text.startsWith("select 1 from projects")) return { rowCount: 0, rows: [] }; // name is unique
  if (text.startsWith("insert into projects")) {
    stored = projectRow({ projectmanagerid: params[12], sitemanagerid: params[13] });
    return { rowCount: 1, rows: [stored] };
  }
  if (text.startsWith("select") && text.includes("from projects where projectid")) {
    return stored ? { rowCount: 1, rows: [stored] } : { rowCount: 0, rows: [] };
  }
  if (text.startsWith("update projects set sitemanagerid")) {
    stored = { ...stored, sitemanagerid: params[0] };
    return { rowCount: 1, rows: [stored] };
  }
  if (text.startsWith("update projects")) {
    return { rowCount: 1, rows: [stored] };
  }
  return { rowCount: 0, rows: [] };
}

const realRules = require("../src/lib/projectRules");
stub("../src/lib/db", { query: fakeQuery, withTransaction: async (fn) => fn({ query: fakeQuery }) });
stub("../src/middleware/auth", {
  requireAuth: (req, _res, next) => {
    req.user = { id: "gm-1", role: "General Manager" };
    next();
  },
});
stub("../src/lib/reassignSiteManager", { reassignSiteManager: async () => {} });
stub("../src/lib/projectRules", {
  ...realRules,
  loadProjectSettings: async () => ({ ...realRules.DEFAULT_SETTINGS, pmMaxOpenProjects: 1, smMaxOpenProjects: 3, serviceAreaMunicipalities: ["consolacion"] }),
  assertManagerAvailable: async () => {},
  notifyProject: async (_client, n) => {
    notifications.push(n);
  },
});

const projectsRouter = require("../src/routes/projects");

function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/projects", projectsRouter);
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, () => resolve(server));
  });
}

async function send(server, method, url, body) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function newProject(overrides = {}) {
  return {
    name: "Consolacion Two-Storey Residence",
    clientName: "Sample Client",
    projectType: "Residential Building",
    municipality: "Consolacion",
    province: "Cebu",
    budget: 0,
    startDate: "2026-11-02",
    constructionStartDate: "2027-01-11",
    endDate: "2027-06-30",
    projectManagerId: PM_A,
    ...overrides,
  };
}

function assigned() {
  return notifications.filter((n) => n.type === "ProjectAssigned").map((n) => n.recipientId);
}

async function withServer(fn) {
  const server = await startServer();
  notifications.length = 0;
  try {
    await fn(server);
  } finally {
    server.close();
  }
}

test("create with a PM only: one ProjectAssigned, to the PM", async () => {
  await withServer(async (server) => {
    const res = await send(server, "POST", "/api/projects", newProject());
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(assigned(), [PM_A]);
  });
});

test("create with a PM and an SM: two ProjectAssigned, one each", async () => {
  await withServer(async (server) => {
    const res = await send(server, "POST", "/api/projects", newProject({ siteManagerId: SM_A }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(assigned().sort(), [PM_A, SM_A].sort());
  });
});

test("assign an SM later: the SM gets one ProjectAssigned", async () => {
  stored = projectRow({ sitemanagerid: null });
  await withServer(async (server) => {
    const res = await send(server, "PATCH", `/api/projects/${PROJECT_ID}/site-manager`, { siteManagerId: SM_A });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(assigned(), [SM_A]);
  });
});

test("clearing the SM sends no notification", async () => {
  stored = projectRow({ sitemanagerid: SM_A });
  await withServer(async (server) => {
    const res = await send(server, "PATCH", `/api/projects/${PROJECT_ID}/site-manager`, { siteManagerId: null });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(assigned(), []);
  });
});

test("changing the PM on edit: only the new PM gets ProjectAssigned", async () => {
  stored = projectRow({ projectmanagerid: PM_A });
  await withServer(async (server) => {
    const res = await send(server, "PATCH", `/api/projects/${PROJECT_ID}`, { projectManagerId: PM_B });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(assigned(), [PM_B]);
  });
});

test("saving an edit without changing the PM sends nothing", async () => {
  stored = projectRow({ projectmanagerid: PM_A });
  await withServer(async (server) => {
    const res = await send(server, "PATCH", `/api/projects/${PROJECT_ID}`, { description: "Updated scope" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(assigned(), []);
  });
});
