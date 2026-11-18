// Suspending and resuming a project (GM only), and what a hold stops.
// The routes run for real; the database and auth are replaced.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { assertStatusTransition, OPEN_PROJECT_STATUSES, STATUS_TRANSITIONS } = require("../src/lib/projectRules");

function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const PROJECT = "11111111-1111-4111-8111-111111111111";
const GM = { id: "gm-1", role: "General Manager", name: "Gina GM" };
const PM = { id: "pm-1", role: "Project Manager", name: "Pat PM" };
const state = { me: GM, status: "Active", log: [], notes: [], updates: [] };

const baseRow = () => ({
  projectid: PROJECT, name: "Alpha House", status: state.status,
  projectmanagerid: "pm-1", sitemanagerid: "sm-1", activatedat: "2026-07-10",
});

async function run(sql, params = []) {
  const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
  if (text.includes("from projects where projectid = $1")) return { rowCount: 1, rows: [baseRow()] };
  if (text.startsWith("update projects set status = 'suspended'")) {
    state.updates.push({ to: "Suspended", params });
    return { rowCount: 1, rows: [{ ...baseRow(), status: "Suspended", suspensionreason: params[1], expectedresumedate: params[2] }] };
  }
  if (text.startsWith("update projects set status = 'active'")) {
    state.updates.push({ to: "Active", params });
    return { rowCount: 1, rows: [{ ...baseRow(), status: "Active", suspensionreason: null, expectedresumedate: null }] };
  }
  if (text.startsWith("update projects set status = 'cancelled'")) {
    state.updates.push({ to: "Cancelled", text, params });
    return { rowCount: 1, rows: [{ ...baseRow(), status: "Cancelled" }] };
  }
  if (text.startsWith("insert into project_status_log")) { state.log.push({ text, params }); return { rowCount: 1, rows: [] }; }
  if (text.includes("from users where role = 'purchaser'")) return { rowCount: 1, rows: [{ userid: "pur-1" }] };
  if (text.startsWith("insert into notifications")) { state.notes.push(params); return { rowCount: 1, rows: [] }; }
  return { rowCount: 0, rows: [] };
}
const client = { query: run };

stub("../src/lib/db", { query: run, withTransaction: async (fn) => fn(client) });
stub("../src/middleware/auth", { requireAuth: (req, _res, next) => { req.user = state.me; next(); } });

const router = require("../src/routes/projects");

async function call(method, url, body) {
  const app = express();
  app.use(express.json());
  app.use("/api/projects", router);
  const server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } finally { server.close(); }
}

function reset(status = "Active", me = GM) {
  state.status = status; state.me = me;
  state.log.length = 0; state.notes.length = 0; state.updates.length = 0;
}

const FUTURE = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);

test("rules: Active can be suspended; a suspended project resumes or is cancelled, never completed", () => {
  assert.doesNotThrow(() => assertStatusTransition("Active", "Suspended"));
  assert.doesNotThrow(() => assertStatusTransition("Suspended", "Active"));
  assert.doesNotThrow(() => assertStatusTransition("Suspended", "Cancelled"));
  assert.throws(() => assertStatusTransition("Suspended", "Completed"), (e) => e.status === 409);
  assert.throws(() => assertStatusTransition("Draft", "Suspended"), (e) => e.status === 409);
  assert.throws(() => assertStatusTransition("Completed", "Suspended"), (e) => e.status === 409);
  assert.deepEqual(STATUS_TRANSITIONS.Suspended, ["Active", "Cancelled"]);
});

test("rules: a suspended project still counts as open, so its managers keep their limit", () => {
  assert.ok(OPEN_PROJECT_STATUSES.includes("Suspended"));
});

test("GM suspends an Active project with a reason and an expected date", async () => {
  reset();
  const res = await call("PATCH", `/api/projects/${PROJECT}/suspend`, { reason: "  Client payment delayed ", expectedResumeDate: FUTURE });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, "Suspended");
  assert.deepEqual(state.updates[0].params.slice(1), ["Client payment delayed", FUTURE]);
  assert.equal(state.log.length, 1, "the hold is written to the history");
});

test("the PM, SM and Purchasers are told; the message carries the reason", async () => {
  reset();
  await call("PATCH", `/api/projects/${PROJECT}/suspend`, { reason: "Typhoon" });
  assert.deepEqual(state.notes.map((n) => n[0]).sort(), ["pm-1", "pur-1", "sm-1"]);
  assert.match(state.notes[0][3], /on hold.*Typhoon/);
  assert.equal(state.notes[0][1], "ProjectSuspended");
  assert.equal(state.notes[0][2], PROJECT);
});

test("a reason is required", async () => {
  reset();
  for (const body of [{}, { reason: "   " }, { reason: 5 }]) {
    const res = await call("PATCH", `/api/projects/${PROJECT}/suspend`, body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(state.updates.length, 0);
});

test("a reason over 500 characters is refused", async () => {
  reset();
  const res = await call("PATCH", `/api/projects/${PROJECT}/suspend`, { reason: "x".repeat(501) });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /500 characters or fewer/);
});

test("an expected resume date must be a real date and not in the past", async () => {
  reset();
  assert.equal((await call("PATCH", `/api/projects/${PROJECT}/suspend`, { reason: "r", expectedResumeDate: "soon" })).status, 400);
  const past = await call("PATCH", `/api/projects/${PROJECT}/suspend`, { reason: "r", expectedResumeDate: "2020-01-01" });
  assert.equal(past.status, 400);
  assert.match(past.body.error, /past/);
});

test("only an Active project can be suspended", async () => {
  for (const status of ["Draft", "Suspended", "Completed", "Cancelled"]) {
    reset(status);
    const res = await call("PATCH", `/api/projects/${PROJECT}/suspend`, { reason: "r" });
    assert.equal(res.status, 409, status);
  }
});

test("only the General Manager can suspend or resume", async () => {
  reset("Active", PM);
  assert.equal((await call("PATCH", `/api/projects/${PROJECT}/suspend`, { reason: "r" })).status, 403);
  reset("Suspended", PM);
  assert.equal((await call("PATCH", `/api/projects/${PROJECT}/resume`)).status, 403);
  assert.equal(state.updates.length, 0);
});

test("resume puts a Suspended project back to Active, clears the hold and tells the team", async () => {
  reset("Suspended");
  const res = await call("PATCH", `/api/projects/${PROJECT}/resume`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, "Active");
  assert.equal(res.body.suspensionreason, null);
  assert.equal(state.log.length, 1);
  assert.deepEqual(state.notes.map((n) => n[0]).sort(), ["pm-1", "pur-1", "sm-1"]);
  assert.match(state.notes[0][3], /back on/);
});

test("resume on a project that is not suspended is a 409", async () => {
  reset("Active");
  const res = await call("PATCH", `/api/projects/${PROJECT}/resume`);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Only a suspended project/);
});

test("cancelling a suspended project clears the hold and keeps it in the history", async () => {
  reset("Suspended");
  const res = await call("PATCH", `/api/projects/${PROJECT}/cancel`, { reason: "Client withdrew" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.match(state.updates[0].text, /suspendedat = null, suspensionreason = null, expectedresumedate = null/);
  assert.equal(state.log.length, 1);
  assert.match(state.log[0].text, /'suspended', 'cancelled'/);
});

test("cancelling an Active project writes no hold history", async () => {
  reset("Active");
  const res = await call("PATCH", `/api/projects/${PROJECT}/cancel`, { reason: "Client withdrew" });
  assert.equal(res.status, 200);
  assert.equal(state.log.length, 0);
});
