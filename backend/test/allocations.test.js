// F8 request validation tests (allocationValidation.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateAllocationSum,
  validateAllocationBody,
  validatePlanInput,
  parseMoneyCents,
  parseQuantityH,
} = require("../src/lib/allocationValidation");

const TICKET_A = "ef403363-8377-46ee-902f-54634c558356";

function validBody(overrides = {}) {
  return {
    receiptImageURL: "http://localhost:3000/receipts/files/00000000-0000-4000-8000-000000000000.jpg",
    vendorName: "Cebu Builders Supply",
    receiptDate: "2026-10-03",
    category: "Materials",
    tin: "123-456-789-000",
    birPermitNumber: "FP-0123",
    birNumber: "OR 4567",
    receiptTotal: 17300,
    lineItems: [
      { description: "Portland cement 40kg", quantity: 60, amount: 16800 },
      { description: "Delivery fee", quantity: 0, amount: 500 },
    ],
    excludeTicketIDs: [],
    feeTargets: {},
    ...overrides,
  };
}

// ---- Manuscript unit tests ----

test("UTC-003: 2000 + 2500 against 4500 is valid", () => {
  assert.deepEqual(validateAllocationSum([{ amount: 2000 }, { amount: 2500 }], 4500), { valid: true });
});

test("UTC-004: 2000 + 2000 against 4500 is invalid", () => {
  assert.deepEqual(validateAllocationSum([{ amount: 2000 }, { amount: 2000 }], 4500), {
    valid: false,
    error: "Allocation sum does not match receipt total",
  });
});

test("validateAllocationSum compares centavos, not floats", () => {
  // 0.1 + 0.2 !== 0.3 in floating point, but 10 + 20 === 30 centavos.
  assert.deepEqual(validateAllocationSum([{ amount: 0.1 }, { amount: 0.2 }], 0.3), { valid: true });
});

test("validateAllocationSum returns valid:false instead of throwing on bad input", () => {
  assert.equal(validateAllocationSum([], 100).valid, false);
  assert.equal(validateAllocationSum([{ amount: -1 }], 100).valid, false);
  assert.equal(validateAllocationSum([{ amount: 100 }], "100").valid, false);
});

// ---- Body validation ----

test("accepts a valid split body and converts to integer units", () => {
  const body = validateAllocationBody(validBody());
  assert.equal(body.receiptTotalCents, 1730000);
  assert.equal(body.lineItems[0].quantityH, 6000);
  assert.equal(body.lineItems[0].amountCents, 1680000);
  assert.equal(body.lineItems[1].quantityH, 0);
  assert.deepEqual(body.excludeTicketIDs, []);
  assert.deepEqual(body.feeTargets, {});
});

test("every line needs a quantity; 0 is allowed for fees", () => {
  assert.throws(
    () => validateAllocationBody(validBody({ lineItems: [{ description: "Portland cement 40kg", amount: 100 }] })),
    (error) => error.status === 400 && /quantity is required/.test(error.message)
  );
  assert.equal(validatePlanInput({ lineItems: [{ description: "VAT", quantity: 0, amount: 12 }] }).lineItems[0].quantityH, 0);
});

test("rejects empty descriptions, negative quantities and three-decimal quantities", () => {
  assert.throws(() => validatePlanInput({ lineItems: [{ description: " ", quantity: 1, amount: 1 }] }), /description is required/);
  assert.throws(() => validatePlanInput({ lineItems: [{ description: "Sand", quantity: -1, amount: 1 }] }), /non-negative/);
  assert.throws(() => validatePlanInput({ lineItems: [{ description: "Sand", quantity: 1.005, amount: 1 }] }), /two decimal places/);
});

test("excludeTicketIDs must be UUIDs and are lowercased and de-duplicated", () => {
  const upper = TICKET_A.toUpperCase();
  assert.deepEqual(validatePlanInput({ ...validBody(), excludeTicketIDs: [upper, TICKET_A] }).excludeTicketIDs, [TICKET_A]);
  assert.throws(() => validatePlanInput({ ...validBody(), excludeTicketIDs: ["nope"] }), /valid UUID/);
});

test("feeTargets may only move quantity-0 lines that exist", () => {
  assert.deepEqual(validatePlanInput({ ...validBody(), feeTargets: { 1: TICKET_A } }).feeTargets, { 1: TICKET_A });
  assert.throws(() => validatePlanInput({ ...validBody(), feeTargets: { 0: TICKET_A } }), /only move quantity-0 lines/);
  assert.throws(() => validatePlanInput({ ...validBody(), feeTargets: { 5: TICKET_A } }), /not a valid line index/);
  assert.throws(() => validatePlanInput({ ...validBody(), feeTargets: { 1: "x" } }), /valid ticket UUID/);
});

test("rejects negative, non-finite, and fractional-centavo amounts", () => {
  for (const value of [-0.01, Number.NaN, Number.POSITIVE_INFINITY, 0.001]) {
    assert.throws(() => parseMoneyCents(value, "amount"), (error) => error.status === 400);
  }
  assert.equal(parseQuantityH(2.5, "quantity"), 250);
});

test("rejects impossible dates and unsupported expense categories", () => {
  assert.throws(
    () => validateAllocationBody(validBody({ receiptDate: "2026-02-30" })),
    (error) => error.status === 400 && /valid YYYY-MM-DD/.test(error.message)
  );
  assert.throws(
    () => validateAllocationBody(validBody({ category: "Labor" })),
    (error) => error.status === 400 && /category must be one of/.test(error.message)
  );
});
