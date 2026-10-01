const test = require("node:test");
const assert = require("node:assert/strict");
const { validateAllocationBody, parseMoneyCents } = require("../src/lib/allocationValidation");

const PROJECT_A = "ef403363-8377-46ee-902f-54634c558356";
const PROJECT_B = "17cb7b95-8b0f-41e9-bf95-4909090b98a6";

function validBody(overrides = {}) {
  return {
    receiptImageURL: "http://localhost:3000/receipts/files/00000000-0000-4000-8000-000000000000.jpg",
    vendorName: "Ace Hardware",
    receiptDate: "2026-09-10",
    category: "Materials",
    receiptTotal: 45.75,
    tin: "123-456-789-000",
    birPermitNumber: "FP012345",
    birNumber: "OR-123",
    portions: [
      { projectID: PROJECT_A, amount: 20 },
      { projectID: PROJECT_B, amount: 25.75 },
    ],
    ...overrides,
  };
}

test("accepts portions whose exact centavo sum equals the client receipt total", () => {
  const body = validateAllocationBody(validBody());
  assert.equal(body.receiptTotalCents, 4575);
  assert.equal(body.portions.reduce((sum, portion) => sum + portion.amountCents, 0), 4575);
  assert.equal(body.portions[0].projectID, PROJECT_A);
});

test("rejects a mismatched total with the mismatch amount in the error", () => {
  assert.throws(
    () => validateAllocationBody(validBody({ receiptTotal: 46 })),
    (error) => error.status === 400 && /mismatch 0\.25/.test(error.message)
  );
});

test("requires at least two portions", () => {
  assert.throws(
    () => validateAllocationBody(validBody({ portions: [{ projectID: PROJECT_A, amount: 45.75 }] })),
    (error) => error.status === 400 && /at least two/.test(error.message)
  );
});

test("rejects invalid project IDs and duplicate project allocations", () => {
  assert.throws(
    () => validateAllocationBody(validBody({ portions: [
      { projectID: "not-a-uuid", amount: 20 },
      { projectID: PROJECT_B, amount: 25.75 },
    ] })),
    (error) => error.status === 400 && /valid UUID/.test(error.message)
  );
  assert.throws(
    () => validateAllocationBody(validBody({ portions: [
      { projectID: PROJECT_A, amount: 20 },
      { projectID: PROJECT_A, amount: 25.75 },
    ] })),
    (error) => error.status === 400 && /only once/.test(error.message)
  );
});

test("rejects negative, non-finite, and fractional-centavo amounts", () => {
  for (const value of [-0.01, Number.NaN, Number.POSITIVE_INFINITY, 0.001]) {
    assert.throws(() => parseMoneyCents(value, "amount"), (error) => error.status === 400);
  }
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
