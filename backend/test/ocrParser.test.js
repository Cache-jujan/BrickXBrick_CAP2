const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { extractDate, parseReceiptText } = require("../src/lib/parser");
const { lineItemsFromWords, cleanWords, firstAmountToken } = require("../src/lib/layoutLineItems");

const NOW = new Date("2026-10-09T00:00:00Z");
const fixture = (name) => require(path.join(__dirname, "..", "scripts", "receipt-test-results", name));

// --- dates ---
test("M/D/Y is the default reading", () => {
  assert.equal(extractDate("Date: 6-3-25", NOW), "2025-06-03");
});

test("a first number above 12 is read as the day", () => {
  assert.equal(extractDate("Date: 25/8/26", NOW), "2026-08-25");
});

test("impossible dates are dropped", () => {
  assert.equal(extractDate("Date: 2/30/26", NOW), null);
  assert.equal(extractDate("Date: 13/13/26", NOW), null);
});

test("future dates are dropped", () => {
  assert.equal(extractDate("Date: 12/25/26", NOW), null);
});

test("the latest date wins over an older background or printer date", () => {
  assert.equal(extractDate("11/10/2021\nDate:\n8/25/26", NOW), "2026-08-25");
});

test("'Date Issued' printer dates are ignored when a sale date exists", () => {
  assert.equal(extractDate("Date: 6-3-25\nDate Issued: June 7, 2026", NOW), "2025-06-03");
});

// --- BIR permit / ATP ---
test("ATP numbers are recognized and typed", () => {
  const out = parseReceiptText("Authority to Print No.: 080AU20230000001328\n");
  assert.equal(out.birPermitNumber, "080AU20230000001328");
  assert.equal(out.birPermitType, "ATP");
});

test("ATP is preferred over a loose-leaf permit on the same receipt", () => {
  const out = parseReceiptText("BIR ATP OCN: 080AU20250000013069 | Date of ATP: 09-17-2025\nLoose-leaf Permit No.: LLSI-080-0925-00023\n");
  assert.equal(out.birPermitNumber, "080AU20250000013069");
});

test("a PTU permit is typed PTU", () => {
  const out = parseReceiptText("PTU No.: FP112025-123-0564722\n");
  assert.equal(out.birPermitType, "PTU");
});

// --- layout line items ---
test("missing vertex coordinates default to 0", () => {
  const [w] = cleanWords([{ text: "A", vertices: [{ y: 5 }, { x: 3 }, {}, { x: 1, y: 1 }] }]);
  assert.deepEqual(w.vertices, [{ x: 0, y: 5 }, { x: 3, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }]);
});

test("summary text to the right of the table is not read as an amount", () => {
  assert.equal(firstAmountToken("2,592.00 Less : 12 % VAT 1,070.04"), "2,592.00");
  assert.equal(firstAmountToken("Net of VAT / Total 8,916.96"), null);
  assert.equal(firstAmountToken("Piko 7,395.00 LESS :"), "7,395.00");
});

test("receipt 2 (printed invoice): two items that add up to the total", () => {
  const items = lineItemsFromWords(fixture("receipt-2-layout.json").words);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => [i.quantity, i.unitPrice, i.amount]), [[2, 1296, 2592], [5, 1479, 7395]]);
});

test("receipt 6 (handwritten delivery receipt): five items, total 8,950", () => {
  const items = lineItemsFromWords(fixture("receipt-6-layout.json").words);
  assert.equal(items.length, 5);
  assert.equal(items.reduce((s, i) => s + i.amount, 0), 8950);
});

test("no words means no layout result (caller falls back to the text parser)", () => {
  assert.equal(lineItemsFromWords([]), null);
  assert.equal(lineItemsFromWords(undefined), null);
});
