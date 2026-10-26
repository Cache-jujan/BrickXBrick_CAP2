
// F9 follow-ups on POST /expenses and PATCH /expenses/:id/resubmit:
//   1. a screening failure is recorded as a Screening_Failed flag, and the
//      client still gets the saved expense (201), not a 500
//   2. resubmit clears only still-open system flags, so the PM's earlier
//      Rejected flags stay as review history
//   3. resubmit stays Purchaser-only and owner-only (unchanged behaviour)
//
// The routes run for real; only the database, auth and side services are
// replaced, so no network or database is needed.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

// Replace a module with a fake BEFORE the route file loads it. node --test runs
// each test file in its own process, so this cannot leak into other tests.
function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const db = { calls: [], rejectedRow: null, failFlagInsert: false };
const screened = [];
let screenImpl = async () => ({ flagTypes: [] });
let currentUser = { id: "user-1", role: "Purchaser" };

function norm(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

/** Emulate the expense queries the two routes make. */
async function fakeQuery(sql, params = []) {
  db.calls.push({ sql, params });
  const text = norm(sql);
  if (text.startsWith("select ticketid, projectid, status, assignedto")) {
    return { rowCount: 1, rows: [{ ticketid: "ticket-1", projectid: "project-1", status: "Resolved", assignedto: "user-1", submittedby: "user-1", tickettype: "Material Request" }] };
  }
  if (text.startsWith("select siteManagerId".toLowerCase())) {
    return { rowCount: 1, rows: [{ sitemanagerid: currentUser.id }] };
  }
  if (text.startsWith("select projectmanagerid")) {
    return { rowCount: 1, rows: [{ projectmanagerid: currentUser.id }] };
  }
  if (text.startsWith("insert into expenses")) return { rowCount: 1, rows: [{ expenseID: "new-expense" }] };
  if (text.startsWith("insert into fraudflags") && db.failFlagInsert) throw new Error("flag insert failed");
  if (text.startsWith("select * from expenses where expenseid")) {
    // The route filters by owner (second parameter): a different user finds nothing.
    const row = db.rejectedRow;
    return row && row.submittedby === params[1] ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
  }
  if (text.startsWith("update expenses")) return { rowCount: 1, rows: [{ expenseID: params[params.length - 1] }] };
  return { rowCount: 0, rows: [] };
}

stub("../src/lib/db", { query: fakeQuery, withTransaction: async (fn) => fn({ query: fakeQuery }) });
stub("../src/middleware/auth", { requireAuth: (req, _res, next) => { req.user = currentUser; next(); } });
stub("../src/lib/receiptStorage", { receiptImageExists: async () => true });
stub("../src/lib/projectRules", { assertProjectActive: async () => {} });
stub("../src/lib/screenExpense", {
  screenExpense: async (id) => { screened.push(id); return screenImpl(id); },
});
stub("../src/lib/blockchainService", { canonicalizeExpenseV2: () => "hash", submitHashWithTimeout: async () => ({}) });

const expensesRouter = require("../src/routes/expenses");

function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/expenses", expensesRouter);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
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

function submission(overrides = {}) {
  return {
    projectID: "project-1",
    ticketID: "ticket-1",
    vendorName: "Cebu Builders Supply",
    amount: 500,
    receiptDate: "2026-10-09",
    category: "Materials",
    receiptImageURL: "http://localhost:3000/receipts/files/00000000-0000-4000-8000-000000000000.jpg",
    lineItems: [{ description: "Portland cement 40kg", quantity: 1, amount: 500 }],
    tin: "123-456-789-000",
    birPermitNumber: "FP0123",
    birNumber: "OR 4567",
    ...overrides,
  };
}

function resubmitBody() {
  const body = submission();
  delete body.projectID;
  delete body.receiptImageURL;
  return body;
}

function callsStartingWith(prefix) {
  return db.calls.filter((c) => norm(c.sql).startsWith(prefix));
}

function reset({ user = { id: "user-1", role: "Purchaser" } } = {}) {
  db.calls.length = 0;
  db.rejectedRow = null;
  db.failFlagInsert = false;
  screened.length = 0;
  screenImpl = async () => ({ flagTypes: [] });
  currentUser = user;
}

// ---- 1. screening failure -> Screening_Failed flag, still 201 ---------------

test("POST /expenses: screening throws -> 201 with the saved expense and a Screening_Failed flag", async () => {
  const server = await startServer();
  const realError = console.error;
  console.error = () => {}; // the route logs the failure; keep test output clean
  try {
    reset();
    screenImpl = async () => { throw new Error("vendor lookup exploded"); };
    const res = await send(server, "POST", "/api/expenses", submission());
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.expenseID, "new-expense");
    const flags = callsStartingWith("insert into fraudflags");
    assert.equal(flags.length, 1);
    assert.equal(flags[0].params[0], "new-expense");
    assert.match(String(flags[0].sql), /'Screening_Failed'/);
    assert.match(flags[0].params[1], /review it manually/i);
  } finally {
    console.error = realError;
    server.close();
  }
});

test("POST /expenses: screening works -> no Screening_Failed flag is written", async () => {
  const server = await startServer();
  try {
    reset();
    const res = await send(server, "POST", "/api/expenses", submission());
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(screened, ["new-expense"]);
    assert.equal(callsStartingWith("insert into fraudflags").length, 0);
  } finally {
    server.close();
  }
});

test("POST /expenses: screening AND the failure flag both fail -> still 201", async () => {
  const server = await startServer();
  const realError = console.error;
  console.error = () => {};
  try {
    reset();
    db.failFlagInsert = true;
    screenImpl = async () => { throw new Error("screening down"); };
    const res = await send(server, "POST", "/api/expenses", submission());
    assert.equal(res.status, 201, JSON.stringify(res.body));
  } finally {
    console.error = realError;
    server.close();
  }
});

// ---- 2. resubmit keeps the PM's resolved flags -------------------------------

test("resubmit: deletes only still-open system flags, so Rejected flags stay as history", async () => {
  const server = await startServer();
  try {
    reset();
    db.rejectedRow = { expenseid: "exp-9", status: "Rejected", submittedby: "user-1" };
    const res = await send(server, "PATCH", "/api/expenses/exp-9/resubmit", resubmitBody());
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const deletes = callsStartingWith("delete from fraudflags");
    assert.equal(deletes.length, 1);
    const sql = norm(deletes[0].sql);
    assert.match(sql, /flaggedby = 'system'/);
    assert.match(sql, /resolution = 'pending'/);
    assert.deepEqual(screened, ["exp-9"]);
  } finally {
    server.close();
  }
});

test("resubmit: a screening failure after the edit still returns the updated expense", async () => {
  const server = await startServer();
  const realError = console.error;
  console.error = () => {};
  try {
    reset();
    db.rejectedRow = { expenseid: "exp-9", status: "Rejected", submittedby: "user-1" };
    screenImpl = async () => { throw new Error("screening down"); };
    const res = await send(server, "PATCH", "/api/expenses/exp-9/resubmit", resubmitBody());
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(callsStartingWith("insert into fraudflags").length, 1);
  } finally {
    console.error = realError;
    server.close();
  }
});

// ---- 3. resubmit stays Purchaser-only and owner-only -------------------------

test("resubmit: a Purchaser can resubmit their own Rejected expense", async () => {
  const server = await startServer();
  try {
    reset();
    db.rejectedRow = { expenseid: "exp-9", status: "Rejected", submittedby: "user-1" };
    const res = await send(server, "PATCH", "/api/expenses/exp-9/resubmit", resubmitBody());
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(screened, ["exp-9"]);
  } finally {
    server.close();
  }
});

test("resubmit: a Purchaser cannot resubmit someone else's expense (404)", async () => {
  const server = await startServer();
  try {
    reset({ user: { id: "user-2", role: "Purchaser" } });
    db.rejectedRow = { expenseid: "exp-9", status: "Rejected", submittedby: "user-1" };
    const res = await send(server, "PATCH", "/api/expenses/exp-9/resubmit", resubmitBody());
    assert.equal(res.status, 404);
    assert.equal(callsStartingWith("update expenses").length, 0);
  } finally {
    server.close();
  }
});

test("resubmit: a Site Manager is still refused (403, Purchaser only)", async () => {
  const server = await startServer();
  try {
    reset({ user: { id: "user-1", role: "Site Manager" } });
    db.rejectedRow = { expenseid: "exp-9", status: "Rejected", submittedby: "user-1" };
    const res = await send(server, "PATCH", "/api/expenses/exp-9/resubmit", resubmitBody());
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test("resubmit: an expense that is not Rejected cannot be resubmitted (409)", async () => {
  const server = await startServer();
  try {
    reset();
    db.rejectedRow = { expenseid: "exp-9", status: "Approved", submittedby: "user-1" };
    const res = await send(server, "PATCH", "/api/expenses/exp-9/resubmit", resubmitBody());
    assert.equal(res.status, 409);
  } finally {
    server.close();
  }
});