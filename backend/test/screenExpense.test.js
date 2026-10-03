const test = require("node:test");
const assert = require("node:assert/strict");

const { screenExpense } = require("../src/lib/screenExpense");

// A fake query that answers by looking at the SQL, and records FraudFlags inserts.
function fakeDatabase({ expense, approvedMatches = [], vendor = null, ticket = null }) {
  const inserted = [];
  async function query(sql, params) {
    if (sql.includes("FROM expenses WHERE expenseid")) {
      return expense ? { rowCount: 1, rows: [expense] } : { rowCount: 0, rows: [] };
    }
    if (sql.includes("FROM receiptallocations")) return { rowCount: 0, rows: [] };
    if (sql.includes("e.status = 'Approved'")) {
      return { rowCount: approvedMatches.length, rows: approvedMatches };
    }
    if (sql.includes("FROM vendormasterlist")) {
      return vendor ? { rowCount: 1, rows: [vendor] } : { rowCount: 0, rows: [] };
    }
    if (sql.includes("FROM tickets")) {
      return ticket ? { rowCount: 1, rows: [ticket] } : { rowCount: 0, rows: [] };
    }
    if (sql.includes("INSERT INTO FraudFlags")) {
      inserted.push({ sql, params });
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`Unexpected SQL in test: ${sql}`);
  }
  return { query, inserted };
}

const cleanExpense = {
  expenseid: "exp-1",
  ticketid: null,
  vendorname: "Cebu Builders Supply",
  tin: "123456789000",
  birpermitnumber: "FP0123",
  birnumber: "OR4567",
  lineitems: [{ description: "Portland cement 40kg", quantity: 20, amount: 5600 }],
  quantity: "20.00",
};

test("a clean expense returns no flags and writes nothing", async () => {
  const db = fakeDatabase({ expense: cleanExpense, vendor: { vendorid: "v1", approvalstatus: "Approved" } });
  const result = await screenExpense("exp-1", { query: db.query });
  assert.deepEqual(result, { flagTypes: [] });
  assert.equal(db.inserted.length, 0);
});

test("a missing expense is not an error", async () => {
  const db = fakeDatabase({ expense: null });
  const result = await screenExpense("nope", { query: db.query });
  assert.deepEqual(result, { flagTypes: [] });
});

test("duplicate and unknown vendor are both flagged, each as Pending", async () => {
  const db = fakeDatabase({
    expense: cleanExpense,
    approvedMatches: [{ expenseid: "exp-0", commonreceiptid: null }],
    vendor: null,
  });
  const result = await screenExpense("exp-1", { query: db.query });
  assert.deepEqual(result.flagTypes, ["BIR_Duplicate", "Vendor_Validation"]);
  for (const flag of db.inserted) {
    assert.match(flag.sql, /'Pending'/);
    assert.equal(flag.params[0], "exp-1");
  }
});

test("a ticket mismatch writes a Ticket_Mismatch flag", async () => {
  const db = fakeDatabase({
    expense: { ...cleanExpense, ticketid: "t-1" },
    vendor: { vendorid: "v1", approvalstatus: "Approved" },
    ticket: { tickettype: "Material Request", materialtype: "rebar", quantity: "20", vendorname: null },
  });
  const result = await screenExpense("exp-1", { query: db.query });
  assert.deepEqual(result.flagTypes, ["Ticket_Mismatch"]);
  assert.equal(db.inserted[0].params[1], "Ticket_Mismatch");
});