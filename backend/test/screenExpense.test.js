const test = require("node:test");
const assert = require("node:assert/strict");

const { screenExpense } = require("../src/lib/screenExpense");

// A fake query that answers by looking at the SQL, and records FraudFlags inserts.
function fakeDatabase({ expense, approvedMatches = [], vendor = null, ticket = null, scan = null, splitTotal = null }) {
  const inserted = [];
  async function query(sql, params) {
    if (sql.includes("FROM expenses WHERE expenseid")) {
      return expense ? { rowCount: 1, rows: [expense] } : { rowCount: 0, rows: [] };
    }
    if (sql.includes("FROM receiptscans")) {
      return scan ? { rowCount: 1, rows: [scan] } : { rowCount: 0, rows: [] };
    }
    if (sql.includes("AS receipttotal")) {
      return splitTotal === null ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ receipttotal: splitTotal }] };
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
test("an adjustment line routes the expense to PM review", async () => {
  const db = fakeDatabase({
    expense: {
      ...cleanExpense,
      lineitems: [
        { description: "Portland cement 40kg", quantity: 20, amount: 5600 },
        { description: "Adjustment / rounding", quantity: 0, amount: 3.5 },
      ],
    },
    vendor: { vendorid: "v1", approvalstatus: "Approved" },
  });
  const result = await screenExpense("exp-1", { query: db.query });
  assert.deepEqual(result.flagTypes, ["Receipt_Adjustment"]);
  assert.equal(db.inserted[0].params[1], "Receipt_Adjustment");
  assert.match(db.inserted[0].params[2], /Adjustment \/ rounding \(₱3\.50\)/);
});

test("a line that only mentions an adjustment mid-name is not flagged", async () => {
  const db = fakeDatabase({
    expense: { ...cleanExpense, lineitems: JSON.stringify([{ description: "Hinge, adjustment type", quantity: 2, amount: 80 }]) },
    vendor: { vendorid: "v1", approvalstatus: "Approved" },
  });
  const result = await screenExpense("exp-1", { query: db.query });
  assert.deepEqual(result.flagTypes, []);
});

// ---- Layer 5: the expense against the server's own scan ---------------------

const scannedDraft = {
  vendorName: "Cebu Builders Supply",
  tin: "123-456-789-000",
  birPermitNumber: "FP-0123",
  birNumber: "OR 4567",
  amount: 5600,
  receiptDate: null,
  lineItems: [{ description: "HEAVY DUTY PLUG", quantity: 20, amount: 5600 }],
};
const approvedVendor = { vendorid: "v1", approvalstatus: "Approved" };
const scannedExpense = { ...cleanExpense, receiptimageurl: "/uploads/receipts/a.jpg", amount: "5600.00" };

test("a line renamed away from what the scan read is flagged Receipt_Edited", async () => {
  const db = fakeDatabase({
    expense: scannedExpense,
    vendor: approvedVendor,
    scan: { status: "Ready", result: scannedDraft },
  });
  const result = await screenExpense("exp-1", { query: db.query });
  assert.deepEqual(result.flagTypes, ["Receipt_Edited"]);
  assert.match(db.inserted[0].params[2], /Line "Portland cement 40kg" is not on the scanned receipt/);
  assert.match(db.inserted[0].params[2], /"HEAVY DUTY PLUG"/);
});

test("an expense that matches its scan gets no Layer 5 flag", async () => {
  const db = fakeDatabase({
    expense: scannedExpense,
    vendor: approvedVendor,
    // pg can hand jsonb back as a string; it still parses.
    scan: { status: "Ready", result: JSON.stringify({ ...scannedDraft, lineItems: [{ description: "Portland Cement 40 kg", quantity: 20, amount: 5600 }] }) },
  });
  const result = await screenExpense("exp-1", { query: db.query });
  assert.deepEqual(result.flagTypes, []);
});

test("no scan, or a scan that failed, is flagged Manual_Entry", async () => {
  for (const scan of [null, { status: "Failed", result: null }, { status: "Ready", result: { ...scannedDraft, ocrError: "OCR is unavailable" } }]) {
    const db = fakeDatabase({ expense: scannedExpense, vendor: approvedVendor, scan });
    const result = await screenExpense("exp-1", { query: db.query });
    assert.deepEqual(result.flagTypes, ["Manual_Entry"]);
  }
});

test("a split portion is compared with the whole receipt total", async () => {
  const portion = { ...scannedExpense, amount: "2000.00", lineitems: [{ description: "Heavy duty plug", quantity: 5, amount: 2000 }] };
  const db = fakeDatabase({
    expense: portion,
    vendor: approvedVendor,
    scan: { status: "Ready", result: scannedDraft },
    splitTotal: "5600.00",
  });
  const result = await screenExpense("exp-1", { query: db.query });
  assert.deepEqual(result.flagTypes, []);
});
