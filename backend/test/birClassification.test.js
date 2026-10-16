// F7 — BIR verification and Formal / Informal classification.
//
// receiptFields.test.js covers normalizeBirFields in isolation. This file
// covers what was untested:
//   1. the full classification matrix (which fields make a receipt Formal)
//   2. the routes really use the SERVER's classification: a client that
//      claims "Formal-Tax-Deductible" for a receipt with a missing BIR field
//      is overruled (POST /expenses and PATCH /expenses/:id/resubmit)
//   3. every submit path derives the status from classifyBir (static guard)
//   4. the values the code writes match the database CHECK constraint
//
// The routes run for real; only the database, auth and side services are
// replaced, so no network or database is needed.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const express = require("express");

const { classifyBir, normalizeBirFields } = require("../src/lib/receiptFields");

const FORMAL = "Formal-Tax-Deductible";
const INFORMAL = "Informal";

const ALL = { tin: "123-456-789-000", birPermitNumber: "FP-0123", birNumber: "OR 4567" };
const classify = (raw) => classifyBir(normalizeBirFields(raw));

// ---- 1. classification matrix ----------------------------------------------

test("all three BIR fields present -> Formal", () => {
  assert.deepEqual(classify(ALL), { birValidationStatus: FORMAL, missingBirFields: [] });
});

test("each missing field alone makes the receipt Informal and is named", () => {
  for (const field of ["tin", "birPermitNumber", "birNumber"]) {
    const raw = { ...ALL };
    delete raw[field];
    assert.deepEqual(classify(raw), { birValidationStatus: INFORMAL, missingBirFields: [field] }, field);
  }
});

test("none of the BIR fields -> Informal, all three named", () => {
  assert.deepEqual(classify({}), { birValidationStatus: INFORMAL, missingBirFields: ["tin", "birPermitNumber", "birNumber"] });
});

test("a field that is only punctuation or spaces counts as missing", () => {
  assert.equal(classify({ ...ALL, tin: "---" }).birValidationStatus, INFORMAL);
  assert.equal(classify({ ...ALL, birPermitNumber: "   " }).birValidationStatus, INFORMAL);
  assert.equal(classify({ ...ALL, birNumber: "- -" }).birValidationStatus, INFORMAL);
});

test("a TIN with no digits (letters only) counts as missing", () => {
  assert.equal(classify({ ...ALL, tin: "N/A" }).birValidationStatus, INFORMAL);
});

test("spelling differences do not change the classification", () => {
  const a = classify({ tin: "123 456 789 000", birPermitNumber: "fp 0123", birNumber: "or-4567" });
  const b = classify({ tin: "123-456-789-000", birPermitNumber: "FP-0123", birNumber: "OR 4567" });
  assert.deepEqual(a, b);
});

test("numeric input (not strings) is accepted", () => {
  assert.equal(classify({ tin: 123456789000, birPermitNumber: 123, birNumber: 4567 }).birValidationStatus, FORMAL);
});

// Known gaps. The TIN has a format check, but the permit and OR/SI numbers are
// only checked for presence, so these receipts are currently marked tax-deductible.
// They are marked `todo` so they document the gap without failing the suite;
// turn them into plain tests once the team decides the validation rules.
test("TODO: a placeholder permit number such as N/A should not count as Formal", { todo: true }, () => {
  assert.equal(classify({ ...ALL, birPermitNumber: "N/A" }).birValidationStatus, INFORMAL);
});

test("TIN must be 9 digits plus an optional 3-5 digit branch code", () => {
  for (const tin of ["123-456-789", "123-456-789-000", "123-456-789-0000", "180-400-144-00000"]) {
    assert.equal(classify({ ...ALL, tin }).birValidationStatus, FORMAL, tin);
  }
  for (const tin of ["12", "12345678", "1234567890", "12345678901", "123456789000000"]) {
    assert.deepEqual(classify({ ...ALL, tin }), { birValidationStatus: INFORMAL, missingBirFields: ["tin"] }, tin);
  }
});

test("placeholder TINs (all zeros, one repeated digit) are not Formal", () => {
  for (const tin of ["000-000-000", "000-000-000-000", "111-111-111-000", "999999999"]) {
    assert.equal(classify({ ...ALL, tin }).birValidationStatus, INFORMAL, tin);
  }
});

test("TODO: an OR/SI number of 0 should not count as Formal", { todo: true }, () => {
  assert.equal(classify({ ...ALL, birNumber: "0" }).birValidationStatus, INFORMAL);
});

// ---- 2. the routes use the server's classification --------------------------

// Replace a module with a fake BEFORE the route file loads it. node --test runs
// each test file in its own process, so this cannot leak into other tests.
function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const db = { calls: [], rejectedRow: null };
const screened = [];
let currentUser = { id: "user-1", role: "Purchaser" };

async function fakeQuery(sql, params = []) {
  db.calls.push({ sql, params });
  const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
  if (text.startsWith("select ticketid, projectid, status, assignedto")) {
    return { rowCount: 1, rows: [{ ticketid: "ticket-1", projectid: "project-1", status: "Resolved", assignedto: "user-1", submittedby: "sm-1", tickettype: "Material Request" }] };
  }
  if (text.startsWith("insert into expenses")) return { rowCount: 1, rows: [{ expenseID: "new-expense" }] };
  if (text.startsWith("select * from expenses where expenseid")) {
    return db.rejectedRow ? { rowCount: 1, rows: [db.rejectedRow] } : { rowCount: 0, rows: [] };
  }
  if (text.startsWith("update expenses")) return { rowCount: 1, rows: [{ expenseID: params[params.length - 1] }] };
  return { rowCount: 0, rows: [] };
}

stub("../src/lib/db", { query: fakeQuery, withTransaction: async (fn) => fn({ query: fakeQuery }) });
stub("../src/middleware/auth", { requireAuth: (req, _res, next) => { req.user = currentUser; next(); } });
stub("../src/lib/receiptStorage", { receiptImageExists: async () => true });
stub("../src/lib/projectRules", { assertProjectActive: async () => {} });
stub("../src/lib/screenExpense", { screenExpense: async (id) => { screened.push(id); return { flagTypes: [] }; } });
stub("../src/lib/blockchainService", { canonicalizeExpense: () => "hash", submitHashWithTimeout: async () => ({}) });

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
    ticketID: "ticket-1", // a Purchaser must link a Resolved ticket assigned to them
    vendorName: "Cebu Builders Supply",
    amount: 500,
    receiptDate: "2026-10-09",
    category: "Materials",
    receiptImageURL: "http://localhost:3000/receipts/files/00000000-0000-4000-8000-000000000000.jpg",
    lineItems: [{ description: "Portland cement 40kg", quantity: 1, amount: 500 }],
    ...ALL,
    ...overrides,
  };
}

// Column positions in the route's INSERT / UPDATE parameter lists.
const INSERT = { status: 7, birNumber: 9, tin: 10, permit: 11 };
const UPDATE = { status: 4, birNumber: 5, tin: 6, permit: 7 };

function lastCall(prefix) {
  const hits = db.calls.filter((c) => String(c.sql).replace(/\s+/g, " ").trim().toLowerCase().startsWith(prefix));
  return hits[hits.length - 1];
}

test("POST /expenses: all BIR fields -> stored as Formal, BIR values normalized, then screened", async () => {
  const server = await startServer();
  try {
    db.calls.length = 0;
    screened.length = 0;
    const res = await send(server, "POST", "/api/expenses", submission());
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const insert = lastCall("insert into expenses");
    assert.equal(insert.params[INSERT.status], FORMAL);
    assert.equal(insert.params[INSERT.tin], "123456789000");
    assert.equal(insert.params[INSERT.permit], "FP0123");
    assert.equal(insert.params[INSERT.birNumber], "OR4567");
    assert.deepEqual(screened, ["new-expense"]);
  } finally {
    server.close();
  }
});

test("POST /expenses: missing permit -> Informal, even if the client claims Formal", async () => {
  const server = await startServer();
  try {
    db.calls.length = 0;
    const res = await send(server, "POST", "/api/expenses", submission({ birPermitNumber: "", birValidationStatus: FORMAL }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const insert = lastCall("insert into expenses");
    assert.equal(insert.params[INSERT.status], INFORMAL);
    assert.equal(insert.params[INSERT.permit], null);
  } finally {
    server.close();
  }
});

test("POST /expenses: no BIR fields at all -> Informal and still accepted", async () => {
  const server = await startServer();
  try {
    db.calls.length = 0;
    const res = await send(server, "POST", "/api/expenses", submission({ tin: undefined, birPermitNumber: undefined, birNumber: undefined }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(lastCall("insert into expenses").params[INSERT.status], INFORMAL);
  } finally {
    server.close();
  }
});

test("POST /expenses: a Purchaser's claim of Informal cannot downgrade a complete receipt either", async () => {
  const server = await startServer();
  try {
    db.calls.length = 0;
    const res = await send(server, "POST", "/api/expenses", submission({ birValidationStatus: INFORMAL }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(lastCall("insert into expenses").params[INSERT.status], FORMAL);
  } finally {
    server.close();
  }
});

test("resubmit: adding the missing permit upgrades the expense to Formal and re-screens it", async () => {
  const server = await startServer();
  try {
    db.calls.length = 0;
    screened.length = 0;
    db.rejectedRow = { expenseid: "exp-9", status: "Rejected", submittedby: "user-1" };
    const body = submission();
    delete body.projectID;
    delete body.receiptImageURL;
    const res = await send(server, "PATCH", "/api/expenses/exp-9/resubmit", body);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const update = lastCall("update expenses");
    assert.equal(update.params[UPDATE.status], FORMAL);
    assert.equal(update.params[UPDATE.tin], "123456789000");
    assert.equal(update.params[UPDATE.permit], "FP0123");
    assert.equal(update.params[UPDATE.birNumber], "OR4567");
    assert.deepEqual(screened, ["exp-9"]);
  } finally {
    db.rejectedRow = null;
    server.close();
  }
});

test("resubmit: a client that claims Formal with a missing OR/SI number is overruled", async () => {
  const server = await startServer();
  try {
    db.calls.length = 0;
    db.rejectedRow = { expenseid: "exp-9", status: "Rejected", submittedby: "user-1" };
    const body = submission({ birNumber: "", birValidationStatus: FORMAL });
    delete body.projectID;
    delete body.receiptImageURL;
    const res = await send(server, "PATCH", "/api/expenses/exp-9/resubmit", body);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(lastCall("update expenses").params[UPDATE.status], INFORMAL);
  } finally {
    db.rejectedRow = null;
    server.close();
  }
});

test("resubmit: only a Rejected expense can be resubmitted", async () => {
  const server = await startServer();
  try {
    db.rejectedRow = { expenseid: "exp-9", status: "Approved", submittedby: "user-1" };
    const body = submission();
    delete body.projectID;
    const res = await send(server, "PATCH", "/api/expenses/exp-9/resubmit", body);
    assert.equal(res.status, 409);
  } finally {
    db.rejectedRow = null;
    server.close();
  }
});

test("a Site Manager cannot resubmit (Purchaser only)", async () => {
  const server = await startServer();
  try {
    currentUser = { id: "user-2", role: "Site Manager" };
    const res = await send(server, "PATCH", "/api/expenses/exp-9/resubmit", submission());
    assert.equal(res.status, 403);
  } finally {
    currentUser = { id: "user-1", role: "Purchaser" };
    server.close();
  }
});

// ---- 3. every submit path derives the status from classifyBir ---------------

const ROUTES = ["expenses.js", "allocations.js", "sync.js"];

test("every route that stores an expense classifies BIR on the server", () => {
  for (const file of ROUTES) {
    const source = fs.readFileSync(path.join(__dirname, "../src/routes", file), "utf8");
    assert.match(source, /classifyBir\(/, `${file} must call classifyBir`);
    assert.match(source, /normalizeBirFields\(/, `${file} must normalize BIR fields first`);
  }
});

test("no route reads birValidationStatus from the request", () => {
  for (const file of ROUTES) {
    const source = fs.readFileSync(path.join(__dirname, "../src/routes", file), "utf8");
    // Allowed: `const { birValidationStatus } = classifyBir(...)`. Anything else
    // that pulls the field out of a request or payload is a way to spoof it.
    const destructures = source.match(/\{[^{}]*\bbirValidationStatus\b[^{}]*\}\s*=\s*[^;]+;/g) || [];
    for (const statement of destructures) {
      assert.match(statement, /=\s*classifyBir\(/, `${file}: ${statement.trim()}`);
    }
    assert.doesNotMatch(source, /(req\.body|payload|body)\.birValidationStatus/, `${file} reads the status from the client`);
  }
});

// ---- 4. the code and the database agree on the two values -------------------

test("the two statuses are exactly what the expenses CHECK constraint allows", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../../infra/db/migrations/001_initial_schema.sql"), "utf8");
  const check = sql.match(/birValidationStatus[^\n]*CHECK \(birValidationStatus IN \(([^)]*)\)\)/i);
  assert.ok(check, "constraint not found in 001_initial_schema.sql");
  const allowed = check[1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
  assert.deepEqual(allowed, [FORMAL, INFORMAL].sort());
});
