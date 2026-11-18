// Approving an expense marks its chain write as Pending in the same transaction,
// so a crash before the chain write can't leave it at 'None'.
// The routes run for real. Only the database, auth and side services are replaced.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

// Replace a module with a fake BEFORE the route file loads it.
function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const db = { calls: [], row: null, updateExpensesRowCount: 1 };
let inTransaction = false;
let chainImpl = async () => ({ txHash: "0xabc", blockNumber: 7, validatorNodeCount: 3 });
let currentUser = { id: "gm-1", role: "General Manager", name: "gm.general-manager" };

function norm(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

async function fakeQuery(sql, params = []) {
  db.calls.push({ sql, params, inTransaction });
  const text = norm(sql);
  if (text.startsWith("select * from expenses where expenseid")) {
    // Approve reads by id only. Resubmit also filters by the owner (second parameter).
    const row = db.row;
    if (!row) return { rowCount: 0, rows: [] };
    if (params.length > 1 && row.submittedby !== params[1]) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [row] };
  }
  if (text.startsWith("update expenses set status = 'approved'")) return { rowCount: 1, rows: [] };
  if (text.startsWith("update expenses")) {
    return { rowCount: db.updateExpensesRowCount, rows: db.updateExpensesRowCount ? [{ expenseID: params[params.length - 1] }] : [] };
  }
  if (text.startsWith("select 1 from tickets")) return { rowCount: 1, rows: [] };
  if (text.startsWith("select t.approvedbudget")) return { rowCount: 1, rows: [{ remaining: "100000.00" }] };
  return { rowCount: 0, rows: [] };
}

stub("../src/lib/db", {
  query: fakeQuery,
  withTransaction: async (fn) => {
    inTransaction = true;
    try { return await fn({ query: fakeQuery }); } finally { inTransaction = false; }
  },
});
stub("../src/middleware/auth", { requireAuth: (req, _res, next) => { req.user = currentUser; next(); } });
stub("../src/lib/receiptStorage", { receiptImageExists: async () => true });
stub("../src/lib/projectRules", { assertProjectActive: async () => {} });
stub("../src/lib/screenExpense", { screenExpense: async () => ({ flagTypes: [] }), screenOrFlag: async () => {} });
stub("../src/lib/blockchainService", {
  canonicalizeExpenseV2: () => "hash",
  submitHashWithTimeout: (hash) => chainImpl(hash),
});

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
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function callsStartingWith(prefix) {
  return db.calls.filter((c) => norm(c.sql).startsWith(prefix));
}

function reset({ user, row, updateExpensesRowCount = 1 } = {}) {
  db.calls.length = 0;
  db.row = row || null;
  db.updateExpensesRowCount = updateExpensesRowCount;
  chainImpl = async () => ({ txHash: "0xabc", blockNumber: 7, validatorNodeCount: 3 });
  currentUser = user || { id: "gm-1", role: "General Manager", name: "gm.general-manager" };
}

const expenseRow = (over = {}) => ({
  expenseid: "exp-1", projectid: "project-1", submittedby: "purchaser-1", status: "Pending",
  vendorname: "Cebu Builders Supply", amount: "500.00", blockchainstatus: "None", ticketid: "ticket-1", ...over,
});

test("approve: the approval UPDATE sets blockchainStatus = 'Pending' inside the transaction", async () => {
  const server = await startServer();
  try {
    reset({ row: expenseRow() });
    const res = await send(server, "PATCH", "/api/expenses/exp-1/approve");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const [approval] = callsStartingWith("update expenses set status = 'approved'");
    assert.ok(approval, "the approval UPDATE ran");
    assert.match(norm(approval.sql), /blockchainstatus = 'pending'/);
    assert.equal(approval.inTransaction, true, "same transaction as the approval, not a later statement");
  } finally {
    server.close();
  }
});

test("approve: chain down gives 202 and nothing marks it Confirmed", async () => {
  const server = await startServer();
  const realError = console.error;
  console.error = () => {};
  try {
    reset({ row: expenseRow() });
    chainImpl = async () => { throw new Error("TIMEOUT"); };
    const res = await send(server, "PATCH", "/api/expenses/exp-1/approve");
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.equal(res.body.blockchain, null);
    assert.equal(callsStartingWith("insert into blockchainlogs").length, 0);
    assert.ok(!db.calls.some((c) => /blockchainstatus = 'confirmed'/.test(norm(c.sql))));
  } finally {
    console.error = realError;
    server.close();
  }
});

test("approve: chain up gives 200, a chain record, then Confirmed", async () => {
  const server = await startServer();
  try {
    reset({ row: expenseRow() });
    const res = await send(server, "PATCH", "/api/expenses/exp-1/approve");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.blockchain.txHash, "0xabc");
    assert.equal(callsStartingWith("insert into blockchainlogs").length, 1);
    assert.ok(db.calls.some((c) => /blockchainstatus = 'confirmed'/.test(norm(c.sql))));
  } finally {
    server.close();
  }
});
