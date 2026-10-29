// The General Manager is told when a Project Manager approves or rejects an
// expense. A decision made by the GM themselves tells the GM nothing new.
//
// The expense routes run for real; the database, auth and side services are replaced.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const state = { notifications: [], status: "Pending" };
let currentUser = { id: "pm-1", name: "marco.project-manager", role: "Project Manager" };

const norm = (sql) => String(sql).replace(/\s+/g, " ").trim().toLowerCase();

async function fakeQuery(sql, params = []) {
  const text = norm(sql);
  if (text.startsWith("select * from expenses where expenseid")) {
    return {
      rowCount: 1,
      rows: [{ expenseid: "exp-1", projectid: "project-1", status: state.status, submittedby: "purchaser-1", vendorname: "Hardware Depot", amount: "12500.5" }],
    };
  }
  if (text.startsWith("select projectmanagerid") || text.includes("from projects where projectid")) {
    return { rowCount: 1, rows: [{ projectmanagerid: "pm-1", sitemanagerid: "sm-1" }] };
  }
  if (text.startsWith("update expenses set status = 'approved'")) return { rowCount: 1, rows: [] };
  if (text.startsWith("update expenses set status = 'rejected'")) return { rowCount: 1, rows: [{ expenseid: "exp-1" }] };
  if (text.startsWith("update fraudflags")) return { rowCount: 0, rows: [] };
  if (text.startsWith("select userid from users where role = 'general manager'")) {
    return { rowCount: 2, rows: [{ userid: "gm-1" }, { userid: "gm-2" }] };
  }
  if (text.startsWith("insert into notifications")) {
    // Direct inserts carry the type in the SQL text; lib/notify.js passes it as a parameter.
    const direct = /'(expense\w+)'/i.exec(String(sql));
    state.notifications.push(
      direct
        ? { recipientid: params[0], type: direct[1], message: params[2] }
        : { recipientid: params[0], type: params[1], message: params[4] }
    );
    return { rowCount: 1, rows: [] };
  }
  return { rowCount: 0, rows: [] };
}

stub("../src/lib/db", { query: fakeQuery, withTransaction: async (fn) => fn({ query: fakeQuery }) });
stub("../src/middleware/auth", { requireAuth: (req, _res, next) => { req.user = currentUser; next(); } });
stub("../src/lib/receiptStorage", { receiptImageExists: async () => true });
stub("../src/lib/projectRules", { assertProjectActive: async () => {} });
stub("../src/lib/screenExpense", { screenExpense: async () => ({ flagTypes: [] }) });
stub("../src/lib/blockchainService", { canonicalizeExpenseV2: () => "hash", submitHashWithTimeout: async () => ({}) });

const expensesRouter = require("../src/routes/expenses");

async function call(method, url, body) {
  const app = express();
  app.use(express.json());
  app.use("/api/expenses", expensesRouter);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const server = await new Promise((r) => { const s = http.createServer(app).listen(0, () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } finally {
    server.close();
  }
}

const reset = (user) => { state.notifications = []; state.status = "Pending"; currentUser = user; };
const PM = { id: "pm-1", name: "marco.project-manager", role: "Project Manager" };
const GM = { id: "gm-1", name: "lea.general-manager", role: "General Manager" };

test("a PM approving an expense tells the submitter and every General Manager", async () => {
  reset(PM);
  const r = await call("PATCH", "/api/expenses/exp-1/approve");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const recipients = state.notifications.map((n) => n.recipientid).sort();
  assert.deepEqual(recipients, ["gm-1", "gm-2", "purchaser-1"]);
  const gm = state.notifications.find((n) => n.recipientid === "gm-1");
  assert.equal(gm.type, "ExpenseApproved");
  assert.match(gm.message, /marco\.project-manager approved an expense: Hardware Depot/);
  assert.match(gm.message, /12,500\.5/);
});

test("a PM rejecting an expense tells the submitter and every General Manager, with the reason", async () => {
  reset(PM);
  const r = await call("PATCH", "/api/expenses/exp-1/reject", { reason: "Receipt is unreadable" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(state.notifications.map((n) => n.recipientid).sort(), ["gm-1", "gm-2", "purchaser-1"]);
  const gm = state.notifications.find((n) => n.recipientid === "gm-2");
  assert.equal(gm.type, "ExpenseRejected");
  assert.match(gm.message, /Receipt is unreadable/);
});

test("when a General Manager decides, only the submitter is told", async () => {
  reset(GM);
  assert.equal((await call("PATCH", "/api/expenses/exp-1/approve")).status, 200);
  assert.deepEqual(state.notifications.map((n) => n.recipientid), ["purchaser-1"]);

  reset(GM);
  assert.equal((await call("PATCH", "/api/expenses/exp-1/reject", { reason: "Duplicate" })).status, 200);
  assert.deepEqual(state.notifications.map((n) => n.recipientid), ["purchaser-1"]);
});
