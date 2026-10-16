// F11 report route tests (routes/reports.js). The route runs for real; the
// database and auth are replaced, same approach as adminUsers.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const state = { me: { id: "u1", role: "General Manager" }, knownProjects: [P1, P2], calls: [] };

async function fakeQuery(sql, params = []) {
  const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
  state.calls.push(text);
  if (text.includes("from projects")) {
    const rows = params[0]
      .filter((id) => state.knownProjects.includes(id))
      .map((id) => ({ projectId: id, name: `Project ${id.slice(0, 2)}`, budget: "50000.00" }));
    return { rows };
  }
  if (text.includes("from fraudflags") || text.includes("fraudflags f")) return { rows: [] };
  if (text.includes("from expenses") && text.includes("status = 'approved'")) {
    return {
      rows: [
        { projectId: P1, amount: "5000.00", receiptDate: "2026-10-05", birValidationStatus: "Formal-Tax-Deductible" },
        { projectId: P1, amount: "7000.00", receiptDate: "2026-10-06", birValidationStatus: "Informal" },
        { projectId: P1, amount: "3000.00", receiptDate: "2026-10-07", birValidationStatus: "Informal" },
      ],
    };
  }
  return { rows: [] };
}

stub("../src/lib/db", { query: fakeQuery });
stub("../src/middleware/auth", {
  requireAuth: (req, _res, next) => {
    req.user = state.me;
    next();
  },
});
const reportsRouter = require("../src/routes/reports");

async function get(url) {
  const app = express();
  app.use(express.json());
  app.use("/api/reports", reportsRouter);
  // same shape as the handler at the bottom of server.js
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, details: err.details }));
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`);
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } finally {
    server.close();
  }
}

const OK = `/api/reports/summary?projectIds=${P1}&from=2026-10-01&to=2026-10-31`;

test("Project Manager, Site Manager and Purchaser all get 403; General Manager gets 200", async () => {
  for (const role of ["Project Manager", "Site Manager", "Purchaser"]) {
    state.me = { id: "u2", role };
    assert.equal((await get(OK)).status, 403, role);
  }
  state.me = { id: "u1", role: "General Manager" };
  assert.equal((await get(OK)).status, 200);
});

test("summary returns the computed figures", async () => {
  const res = await get(OK);
  const [row] = res.body.projects;
  assert.equal(row.periodSpend, 15000);
  assert.equal(row.birDeductibleSpend, 5000);
  assert.equal(row.netPnL, 35000);
  assert.equal(row.utilizationPct, 30);
  assert.equal(res.body.empty, false);
  assert.ok(res.body.generatedAt);
});

test("from after to gives 400", async () => {
  const res = await get(`/api/reports/summary?projectIds=${P1}&from=2026-11-01&to=2026-10-01`);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /on or before/);
});

test("a range longer than 366 days gives 400; exactly 366 is fine", async () => {
  const tooLong = await get(`/api/reports/summary?projectIds=${P1}&from=2025-01-01&to=2026-01-02`);
  assert.equal(tooLong.status, 400);
  const leapYear = await get(`/api/reports/summary?projectIds=${P1}&from=2024-01-01&to=2024-12-31`);
  assert.equal(leapYear.status, 200);
});

test("more than 5 projects, or none, gives 400", async () => {
  const ids = Array.from({ length: 6 }, (_, i) => `${i}1111111-1111-4111-8111-111111111111`).join(",");
  assert.equal((await get(`/api/reports/summary?projectIds=${ids}&from=2026-10-01&to=2026-10-31`)).status, 400);
  assert.equal((await get("/api/reports/summary?from=2026-10-01&to=2026-10-31")).status, 400);
});

test("unknown project id gives 400", async () => {
  const unknown = "99999999-9999-4999-8999-999999999999";
  const res = await get(`/api/reports/summary?projectIds=${P1},${unknown}&from=2026-10-01&to=2026-10-31`);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Unknown project id/);
});

test("bad ids and impossible dates give 400, not a database error", async () => {
  assert.equal((await get("/api/reports/summary?projectIds=abc&from=2026-10-01&to=2026-10-31")).status, 400);
  assert.equal((await get(`/api/reports/summary?projectIds=${P1}&from=2026-02-30&to=2026-03-31`)).status, 400);
  assert.equal((await get(`/api/reports/summary?projectIds=${P1}&from=2026-10-01`)).status, 400);
});

test("duplicate ids are collapsed (project counted once)", async () => {
  const res = await get(`/api/reports/summary?projectIds=${P1},${P1}&from=2026-10-01&to=2026-10-31`);
  assert.equal(res.status, 200);
  assert.equal(res.body.projects.length, 1);
});
