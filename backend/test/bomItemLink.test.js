// bomItemLink.test.js — T2c. A receipt line must keep the BOM item it was
// bought against, all the way from the phone to the stored jsonb.
//
// There are TWO paths and they do NOT share code:
//   single receipt -> normalizeLineItems  (receiptFields.js)
//   split receipt  -> parseAllocationLines (allocationValidation.js)
// Both are covered here, because a fix to one silently leaves the other
// dropping the field — which is exactly the bug this guards.

const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeLineItems } = require("../src/lib/receiptFields");
const { parseAllocationLines } = require("../src/lib/allocationValidation");
const { asUUIDOrNull } = require("../src/lib/uuid");

const BOM_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

// ---- the shared shape check ------------------------------------------------

test("asUUIDOrNull keeps a well-formed id and rejects everything else", () => {
  assert.equal(asUUIDOrNull(BOM_ID), BOM_ID);
  assert.equal(asUUIDOrNull("not-a-uuid"), null);
  assert.equal(asUUIDOrNull("' OR 1=1 --"), null);
  assert.equal(asUUIDOrNull(42), null);
  assert.equal(asUUIDOrNull(null), null);
  assert.equal(asUUIDOrNull(undefined), null);
  assert.equal(asUUIDOrNull(""), null);
});

// ---- single receipt: POST /api/expenses, resubmit, sync --------------------

test("single path: a saved line still carries its bomItemID", () => {
  const [line] = normalizeLineItems([
    { description: "Portland Cement 40kg", amount: 1400, quantity: 5, unitPrice: 280, bomItemID: BOM_ID },
  ]);
  assert.equal(line.bomItemID, BOM_ID);
});

test("single path: a line with no BOM link stores null, not undefined", () => {
  const [line] = normalizeLineItems([
    { description: "Delivery fee", amount: 500, quantity: 0 },
  ]);
  assert.equal(line.bomItemID, null);
  assert.ok("bomItemID" in line, "the key must exist so the column shape is stable");
});

test("single path: a junk bomItemID is stored as null, not as-is", () => {
  const [line] = normalizeLineItems([
    { description: "Rebar 10mm", amount: 900, quantity: 20, bomItemID: "'; DROP TABLE bom; --" },
  ]);
  assert.equal(line.bomItemID, null);
});

// ---- split receipt: POST /api/allocations ---------------------------------

test("split path: a parsed line still carries its bomItemID", () => {
  const [line] = parseAllocationLines([
    { description: "Portland Cement 40kg", quantity: 5, amount: 1400, bomItemID: BOM_ID },
  ]);
  assert.equal(line.bomItemID, BOM_ID);
});

test("split path: a line with no BOM link parses to null", () => {
  const [line] = parseAllocationLines([
    { description: "Delivery fee", quantity: 0, amount: 500 },
  ]);
  assert.equal(line.bomItemID, null);
});

test("split path: a junk bomItemID is parsed to null, not as-is", () => {
  const [line] = parseAllocationLines([
    { description: "Rebar 10mm", quantity: 20, amount: 900, bomItemID: { evil: true } },
  ]);
  assert.equal(line.bomItemID, null);
});

// ---- the two paths must not drift -----------------------------------------

test("both paths agree on the same line", () => {
  const raw = { description: "Portland Cement 40kg", amount: 1400, quantity: 5, bomItemID: BOM_ID };
  const single = normalizeLineItems([raw])[0];
  const split = parseAllocationLines([raw])[0];
  assert.equal(single.bomItemID, split.bomItemID);
});

test("both paths agree that junk is dropped", () => {
  const raw = { description: "Rebar 10mm", amount: 900, quantity: 20, bomItemID: "abc" };
  const single = normalizeLineItems([raw])[0];
  const split = parseAllocationLines([raw])[0];
  assert.equal(single.bomItemID, null);
  assert.equal(split.bomItemID, null);
});