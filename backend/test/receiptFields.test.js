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
// --- applyVendorMaster (vendor-list auto-fill) ---
const { applyVendorMaster } = require("../src/lib/receiptFields");

const MASTER = {
  vendorName: "Padeena Enterprises",
  tin: "180-400-144-00000",
  birPermitType: "ATP",
  birPermitNumber: "080AU2023000001328",
};

test("no master record leaves the draft alone", () => {
  const draft = { vendorName: "Unknown", tin: "1", birPermitNumber: null, birNumber: "9" };
  const out = applyVendorMaster(draft, null);
  assert.deepEqual(out.draft, draft);
  assert.deepEqual(out.autoFilled, []);
  assert.deepEqual(out.vendorConflicts, []);
});

test("empty OCR fields are filled and reported as autoFilled", () => {
  const draft = { vendorName: "PADEENA ENTERPRISES", tin: null, birPermitType: null, birPermitNumber: null, birNumber: "598127" };
  const out = applyVendorMaster(draft, MASTER);
  assert.equal(out.draft.vendorName, "Padeena Enterprises");
  assert.equal(out.draft.tin, MASTER.tin);
  assert.equal(out.draft.birPermitNumber, MASTER.birPermitNumber);
  assert.deepEqual(out.autoFilled, ["tin", "birPermitType", "birPermitNumber"]);
  assert.deepEqual(out.vendorConflicts, []);
});

test("OR/SI is never taken from the master list", () => {
  const out = applyVendorMaster({ vendorName: "x", tin: null, birNumber: null }, { ...MASTER, birNumber: "123" });
  assert.equal(out.draft.birNumber, null);
});

test("matching OCR values are neither autoFilled nor conflicts", () => {
  const draft = { vendorName: "x", tin: "180 400 144 000", birPermitType: "atp", birPermitNumber: "080-AU-2023000001328" };
  const out = applyVendorMaster(draft, MASTER);
  assert.deepEqual(out.autoFilled, []);
  assert.deepEqual(out.vendorConflicts, []);
});

test("a different OCR TIN is reported as a conflict and the master value is kept", () => {
  const draft = { vendorName: "x", tin: "180-400-145-00000", birPermitType: null, birPermitNumber: null };
  const out = applyVendorMaster(draft, MASTER);
  assert.equal(out.draft.tin, MASTER.tin);
  assert.deepEqual(out.vendorConflicts, [{ field: "tin", ocrValue: "180-400-145-00000", masterValue: MASTER.tin }]);
});

test("a master field with no value keeps the OCR reading", () => {
  const out = applyVendorMaster({ vendorName: "x", tin: "111-222-333" }, { vendorName: "X", tin: null });
  assert.equal(out.draft.tin, "111-222-333");
  assert.deepEqual(out.autoFilled, []);
});

test("applyVendorMaster does not mutate its input", () => {
  const draft = { vendorName: "x", tin: null };
  applyVendorMaster(draft, MASTER);
  assert.equal(draft.tin, null);
});
