const test = require("node:test");
const assert = require("node:assert/strict");

const { compareWithScan, manualEntryReason, sameItem, dayOf } = require("../src/lib/scanComparison");

// What the OCR read (ReceiptScans.result, the draft shape).
const draft = {
  vendorName: "Padeena Enterprises",
  tin: "180-400-144-00000",
  birPermitNumber: "080AU2023000001328",
  birNumber: "598127",
  amount: 450,
  receiptDate: "2026-10-09",
  lineItems: [
    { description: "HEAVY DUTY PLUG 3/8", amount: 300, quantity: 2 },
    { description: "Electrical tape", amount: 150, quantity: 3 },
  ],
};

// The same receipt as an expenses row (lowercase keys), unchanged.
const expense = {
  vendorname: "Padeena Enterprises",
  tin: "18040014400000", // stored digits-only, as normalizeBirFields saves it
  birpermitnumber: "080AU2023000001328",
  birnumber: "598127",
  amount: "450.00",
  receiptdate: new Date(2026, 9, 9),
  lineitems: [
    { description: "Heavy duty plug 3/8", amount: 300, quantity: 2 },
    { description: "Electrical tape", amount: 150, quantity: 3 },
  ],
};

const compare = (overrides = {}, options = {}) =>
  compareWithScan({ expense: { ...expense, ...overrides }, draft, receiptAmount: overrides.amount ?? expense.amount, ...options });

test("an expense that matches its scan has no changes", () => {
  assert.deepEqual(compare(), { changes: [], reason: null });
});

test("case, spacing and hyphens are not changes", () => {
  const result = compare({ vendorname: "PADEENA  ENTERPRISES", tin: "180 400 144 00000", birnumber: "598-127" });
  assert.deepEqual(result.changes, []);
});

test("a line renamed to the requested material is listed with what the scan read", () => {
  const result = compare({
    lineitems: [
      { description: "Portland cement", amount: 300, quantity: 2 },
      { description: "Electrical tape", amount: 150, quantity: 3 },
    ],
  });
  assert.match(result.reason, /Line "Portland cement" is not on the scanned receipt/);
  assert.match(result.reason, /The scan read these lines: "HEAVY DUTY PLUG 3\/8", "Electrical tape"/);
});

test("a higher total and a higher line amount are both listed", () => {
  const result = compare({
    amount: "4500.00",
    lineitems: [
      { description: "Heavy duty plug 3/8", amount: 4350, quantity: 2 },
      { description: "Electrical tape", amount: 150, quantity: 3 },
    ],
  });
  assert.ok(result.changes.includes("Total changed from ₱450.00 to ₱4,500.00"));
  assert.ok(result.changes.includes('Line "Heavy duty plug 3/8" amount changed from ₱300.00 to ₱4,350.00'));
});

test("BIR fields changed or typed into a blank are listed", () => {
  const changed = compare({ birnumber: "598128" });
  assert.deepEqual(changed.changes, ['OR/SI number changed from "598127" to "598128"']);

  const typedIn = compareWithScan({ expense, draft: { ...draft, tin: null }, receiptAmount: expense.amount });
  assert.equal(typedIn.changes.length, 1);
  assert.match(typedIn.changes[0], /^TIN ".*" was typed in; the scan read none$/);
});

test("clearing a field is not listed", () => {
  assert.deepEqual(compare({ birpermitnumber: null }).changes, []);
});

test("a changed date is listed; a date the scan didn't read is not", () => {
  assert.deepEqual(compare({ receiptdate: "2026-10-01" }).changes, ["Receipt date changed from 2026-10-09 to 2026-10-01"]);
  const noDate = compareWithScan({ expense, draft: { ...draft, receiptDate: null }, receiptAmount: expense.amount });
  assert.deepEqual(noDate.changes, []);
});

test("adjustment lines are left to the Receipt_Adjustment flag", () => {
  const result = compare({
    lineitems: [...expense.lineitems, { description: "Adjustment / rounding", amount: 0.5, quantity: 0 }],
  });
  assert.deepEqual(result.changes, []);
});

test("a split portion compares the whole receipt total and skips line amounts", () => {
  const portion = { ...expense, amount: "200.00", lineitems: [{ description: "Heavy duty plug 3/8", amount: 200, quantity: 1 }] };
  const result = compareWithScan({ expense: portion, draft, receiptAmount: "450.00", split: true });
  assert.deepEqual(result.changes, []);
});

test("sameItem: typo fixes and word order match, different items don't", () => {
  assert.equal(sameItem("Portlnd cement 40kg", "Portland cement 40kg"), true);
  assert.equal(sameItem("cement portland", "Portland Cement"), true);
  assert.equal(sameItem("Portland cement 40kg", "Portland cement"), true);
  assert.equal(sameItem("Heavy duty plug", "Cement"), false);
  assert.equal(sameItem("nail", "bolt"), false);
  assert.equal(sameItem("", "Cement"), false);
});

test("dayOf reads a pg DATE (local midnight) and a plain date the same way", () => {
  assert.equal(dayOf(new Date(2026, 9, 9)), "2026-10-09");
  assert.equal(dayOf("2026-10-09"), "2026-10-09");
  assert.equal(dayOf(null), null);
});

test("manualEntryReason: no scan, a failed scan, or an OCR error means typed in", () => {
  assert.match(manualEntryReason(null), /No scan of this receipt/);
  assert.match(manualEntryReason({ status: "Failed", result: null }), /could not read/);
  assert.match(manualEntryReason({ status: "Ready", result: { ocrError: "OCR is unavailable" } }), /could not read/);
  assert.equal(manualEntryReason({ status: "Ready", result: draft }), null);
});

test("a very long reason is cut to a bounded length", () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ description: `Made up item number ${i}`, amount: 1, quantity: 1 }));
  const result = compare({ lineitems: many });
  assert.ok(result.reason.length <= 1500);
});
