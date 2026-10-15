// F2 — manager workload and editable assignment limits (adviser item 4).
//   - each open project in the workload carries its progress %
//   - every manager (free or busy) carries their open projects and counts
//   - the GM can read and change the limits (1–10); others can't; bad values are refused
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const settingsRows = new Map([
  ["pm_max_open_projects", "1"],
  ["sm_max_open_projects", "3"],
]);
let me = { id: "gm-1", role: "General Manager" };

async function fakeQuery(sql, params = []) {
  const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
  if (text.startsWith("select settingkey as")) {
    return { rowCount: settingsRows.size, rows: [...settingsRows].map(([key, value]) => ({ key, value })) };
  }
  if (text.startsWith("insert into system_settings")) {
    settingsRows.set(params[0], params[1]);
    return { rowCount: 1, rows: [] };
  }
  return { rowCount: 0, rows: [] };
}

stub("../src/lib/db", { query: fakeQuery, withTransaction: async (fn) => fn({ query: fakeQuery }) });
stub("../src/middleware/auth", {
  requireAuth: (req, _res, next) => {
    req.user = me;
    next();
  },
});

const rules = require("../src/lib/projectRules");
const projectsRouter = require("../src/routes/projects");

async function call(method, url, body) {
  const app = express();
  app.use(express.json());
  app.use("/api/projects", projectsRouter);
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } finally {
    server.close();
  }
}

test("workload: every manager has their open projects, each with progress %", async () => {
  const rows = [
    { userid: "pm-1", name: "Busy PM", email: "busy@gmail.com", projectid: "p1", projectname: "Mandaue Riverside", projectstatus: "Active", progress: "45" },
    { userid: "pm-2", name: "Free PM", email: "free@gmail.com", projectid: null },
  ];
  const workload = await rules.loadManagerWorkload(async () => ({ rows }), "Project Manager", {
    settings: { ...rules.DEFAULT_SETTINGS, pmMaxOpenProjects: 1 },
  });
  const busy = workload.find((m) => m.userid === "pm-1");
  const free = workload.find((m) => m.userid === "pm-2");
  assert.equal(busy.openProjects[0].progress, 45);
  assert.equal(busy.available, false);
  assert.deepEqual([free.openProjects, free.openProjectCount, free.maxOpenProjects, free.available], [[], 0, 1, true]);
});

test("workload query asks for each project's average milestone completion", async () => {
  let sql = "";
  await rules.loadManagerWorkload(async (text) => {
    sql = text;
    return { rows: [] };
  }, "Site Manager", { settings: rules.DEFAULT_SETTINGS });
  assert.match(sql, /AVG\(m\.completionPercentage\)/);
});

test("GM reads the limits", async () => {
  me = { id: "gm-1", role: "General Manager" };
  const res = await call("GET", "/api/projects/settings/limits");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { pm: 1, sm: 3 });
});

test("GM raises the PM limit 1 -> 2, then lowers it back", async () => {
  me = { id: "gm-1", role: "General Manager" };
  let res = await call("PATCH", "/api/projects/settings/limits", { pm: 2 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { pm: 2, sm: 3 });
  res = await call("PATCH", "/api/projects/settings/limits", { pm: 1, sm: 4 });
  assert.deepEqual(res.body, { pm: 1, sm: 4 });
});

test("a raised limit makes a PM with one open project selectable again", async () => {
  const rows = [{ userid: "pm-1", name: "PM", email: "pm@gmail.com", projectid: "p1", projectname: "One", projectstatus: "Active", progress: 10 }];
  const atOne = await rules.loadManagerWorkload(async () => ({ rows }), "Project Manager", { settings: { ...rules.DEFAULT_SETTINGS, pmMaxOpenProjects: 1 } });
  const atTwo = await rules.loadManagerWorkload(async () => ({ rows }), "Project Manager", { settings: { ...rules.DEFAULT_SETTINGS, pmMaxOpenProjects: 2 } });
  assert.equal(atOne[0].available, false);
  assert.equal(atTwo[0].available, true);
});

test("non-GM roles can't read or change the limits", async () => {
  for (const role of ["Project Manager", "Site Manager", "Purchaser", "System Administrator"]) {
    me = { id: "u-1", role };
    assert.equal((await call("PATCH", "/api/projects/settings/limits", { pm: 5 })).status, 403, role);
    assert.equal((await call("GET", "/api/projects/settings/limits")).status, 403, role);
  }
});

test("invalid limits are refused with 400", async () => {
  me = { id: "gm-1", role: "General Manager" };
  for (const body of [{ pm: 0 }, { pm: 11 }, { sm: "two" }, { pm: 2.5 }, {}]) {
    const res = await call("PATCH", "/api/projects/settings/limits", body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});
