const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeBirFields, classifyBir } = require("../src/lib/receiptFields");

test("TIN keeps digits only", () => {
  const out = normalizeBirFields({ tin: "123-456-789-000" });
  assert.equal(out.tin, "123456789000");
});

test("permit and OR/SI are uppercased with spaces and hyphens removed", () => {
  const out = normalizeBirFields({ birPermitNumber: "fp-0123", birNumber: "or 4567" });
  assert.equal(out.birPermitNumber, "FP0123");
  assert.equal(out.birNumber, "OR4567");
});

test("different spellings of the same receipt normalize to the same values", () => {
  const a = normalizeBirFields({ tin: "123 456 789 000", birPermitNumber: "FP 0123", birNumber: "OR-4567" });
  const b = normalizeBirFields({ tin: "123-456-789-000", birPermitNumber: "fp-0123", birNumber: "or 4567" });
  assert.deepEqual(a, b);
});

test("empty results become null", () => {
  const out = normalizeBirFields({ tin: "---", birPermitNumber: "   ", birNumber: "" });
  assert.deepEqual(out, { tin: null, birPermitNumber: null, birNumber: null });
});

test("missing fields become null", () => {
  assert.deepEqual(normalizeBirFields({}), { tin: null, birPermitNumber: null, birNumber: null });
  assert.deepEqual(normalizeBirFields(), { tin: null, birPermitNumber: null, birNumber: null });
});

test("a field that normalizes to empty makes the receipt Informal", () => {
  const bir = normalizeBirFields({ tin: "N/A", birPermitNumber: "FP-0123", birNumber: "OR 4567" });
  assert.equal(classifyBir(bir).birValidationStatus, "Informal");
});