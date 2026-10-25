// F12 72-hour rule (lib/blockchainOverdue.js). A fake query stands in for Postgres.
const test = require("node:test");
const assert = require("node:assert/strict");
const { flagOverduePending } = require("../src/lib/blockchainOverdue");

function fakeDb({ overdue = [], recipients = ["gm1", "admin1"] } = {}) {
  const calls = [];
  const marked = new Set();
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/FROM Expenses e/.test(sql)) return { rows: overdue.filter((e) => !marked.has(e.expenseid)), rowCount: overdue.length };
    if (/FROM users/.test(sql)) return { rows: recipients.map((userid) => ({ userid })), rowCount: recipients.length };
    if (/UPDATE Expenses SET blockchainOverdueAt/.test(sql)) {
      if (marked.has(params[0])) return { rowCount: 0, rows: [] };
      marked.add(params[0]);
      return { rowCount: 1, rows: [] };
    }
    return { rowCount: 1, rows: [] };
  };
  return { query, calls };
}

test("nothing overdue: no marks, no notifications", async () => {
  const db = fakeDb();
  assert.equal(await flagOverduePending({ query: db.query }), 0);
  assert.equal(db.calls.filter((c) => /INSERT INTO notifications/.test(c.sql)).length, 0);
});

test("overdue expense is marked once and every GM / admin is notified", async () => {
  const db = fakeDb({ overdue: [{ expenseid: "e1", vendorname: "Sample Hardware" }] });
  assert.equal(await flagOverduePending({ query: db.query }), 1);
  const inserts = db.calls.filter((c) => /INSERT INTO notifications/.test(c.sql));
  assert.equal(inserts.length, 2);
  assert.ok(inserts.every((c) => /BlockchainOverdue/.test(c.sql) && c.params[1] === "e1"));
  assert.match(inserts[0].params[2], /Sample Hardware/);
  assert.match(inserts[0].params[2], /72 hours/);
});

test("already marked expense is not notified again", async () => {
  const db = fakeDb({ overdue: [{ expenseid: "e1", vendorname: "X" }] });
  await flagOverduePending({ query: db.query });
  const again = await flagOverduePending({ query: db.query });
  assert.equal(again, 0);
});

test("the query only looks at old, pending, unsecured, unmarked expenses", async () => {
  const db = fakeDb();
  await flagOverduePending({ query: db.query });
  const sql = db.calls[0].sql;
  assert.match(sql, /blockchainStatus = 'Pending'/);
  assert.match(sql, /status = 'Approved'/);
  assert.match(sql, /blockchainOverdueAt IS NULL/);
  assert.match(sql, /NOT EXISTS/);
  assert.equal(db.calls[0].params[0], 72);
});
