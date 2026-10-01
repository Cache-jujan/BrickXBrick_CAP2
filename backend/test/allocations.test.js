const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateAllocationBody,
  parseMoneyCents,
  parseQuantityHundredths,
  distributeCents,
} = require("../src/lib/allocationValidation");

const PROJECT_A = "ef403363-8377-46ee-902f-54634c558356";
const PROJECT_B = "17cb7b95-8b0f-41e9-bf95-4909090b98a6";
const COMMON = {
  receiptImageURL: "http://localhost:3000/receipts/files/00000000-0000-4000-8000-000000000000.jpg",
  vendorName: "Ace Hardware",
  receiptDate: "2026-09-10",
  category: "Materials",
  tin: "123-456-789-000",
  birPermitNumber: "FP012345",
  birNumber: "OR-123",
};

function itemizedBody(overrides = {}) {
  return {
    ...COMMON,
    receiptTotal: 8250,
    lineItems: [{ lineNumber: 1, description: "Cement", quantity: 50, amount: 8250, unitPrice: 165 }],
    allocations: [
      { lineNumber: 1, projectID: PROJECT_A, quantity: 30 },
      { lineNumber: 1, projectID: PROJECT_B, quantity: 20 },
    ],
    ...overrides,
  };
}

function manualBody(overrides = {}) {
  return {
    ...COMMON,
    receiptTotal: 45.75,
    manualAmountAllocations: [
      { projectID: PROJECT_A, amount: 20 },
      { projectID: PROJECT_B, amount: 25.75 },
    ],
    ...overrides,
  };
}

function projectAmounts(result) {
  return Object.fromEntries(result.projects.map((project) => [project.projectID, project.amount]));
}

test("UTC003: derives exact project amounts from quantities across a receipt line", () => {
  const result = validateAllocationBody(itemizedBody());
  assert.equal(result.mode, "quantity");
  assert.equal(result.projects.length, 2);
  assert.deepEqual(projectAmounts(result), {
    [PROJECT_A]: "4950.00",
    [PROJECT_B]: "3300.00",
  });
  assert.equal(result.projects.reduce((sum, project) => sum + project.amountCents, 0), 825000);
});

test("requires assigned quantities to equal the source quantity exactly", () => {
  assert.throws(
    () => validateAllocationBody(itemizedBody({ allocations: [
      { lineNumber: 1, projectID: PROJECT_A, quantity: 30 },
      { lineNumber: 1, projectID: PROJECT_B, quantity: 19 },
    ] })),
    (error) => error.status === 400 && /fully allocated \(50\.00\).*49\.00/.test(error.message)
  );
});

test("requires every receipt line to have a project allocation", () => {
  assert.throws(
    () => validateAllocationBody(itemizedBody({ lineItems: [
      { lineNumber: 1, description: "Cement", quantity: 50, amount: 8250 },
      { lineNumber: 2, description: "Sand", quantity: 10, amount: 1000 },
    ] })),
    (error) => error.status === 400 && /line 2 has no project allocation/.test(error.message)
  );
});

test("requires an explicit adjustment type when line subtotal differs from receipt total", () => {
  assert.throws(
    () => validateAllocationBody(itemizedBody({ receiptTotal: 9240 })),
    (error) => error.status === 400 && /choose adjustmentType/.test(error.message)
  );
});

test("UTC005: allocates a tax adjustment proportionally and exactly to cents", () => {
  const result = validateAllocationBody(itemizedBody({ receiptTotal: 9240, adjustmentType: "tax" }));
  assert.equal(result.adjustmentAmountCents, 99000);
  assert.deepEqual(projectAmounts(result), {
    [PROJECT_A]: "5544.00",
    [PROJECT_B]: "3696.00",
  });
  assert.equal(result.projects.reduce((sum, project) => sum + project.amountCents, 0), 924000);
});

test("distributes discount as a negative proportional adjustment", () => {
  const result = validateAllocationBody(itemizedBody({ receiptTotal: 7425, adjustmentType: "discount" }));
  assert.equal(result.adjustmentAmountCents, -82500);
  assert.deepEqual(projectAmounts(result), {
    [PROJECT_A]: "4455.00",
    [PROJECT_B]: "2970.00",
  });
});

test("rejects adjustment types with a sign inconsistent with their meaning", () => {
  assert.throws(
    () => validateAllocationBody(itemizedBody({ receiptTotal: 9240, adjustmentType: "discount" })),
    (error) => error.status === 400 && /discount adjustment must reduce/.test(error.message)
  );
  assert.throws(
    () => validateAllocationBody(itemizedBody({ receiptTotal: 7425, adjustmentType: "tax" })),
    (error) => error.status === 400 && /tax adjustment must increase/.test(error.message)
  );
});

test("UTC006: accepts manual amount fallback when line items are unavailable", () => {
  const result = validateAllocationBody(manualBody());
  assert.equal(result.mode, "amount");
  assert.deepEqual(
    Object.fromEntries(result.projects.map((project) => [project.projectID, [project.amount, project.quantity]])),
    { [PROJECT_A]: ["20.00", null], [PROJECT_B]: ["25.75", null] }
  );
});

test("UTC007: rejects a manual amount fallback whose sum differs from the receipt total", () => {
  assert.throws(
    () => validateAllocationBody(manualBody({ receiptTotal: 46 })),
    (error) => error.status === 400 && /mismatch 0\.25/.test(error.message)
  );
});

test("manual amount fallback cannot be mixed with OCR line items", () => {
  assert.throws(
    () => validateAllocationBody(itemizedBody({ manualAmountAllocations: [{ projectID: PROJECT_A, amount: 8250 }] })),
    (error) => error.status === 400 && /not both/.test(error.message)
  );
});

test("requires at least two distinct projects and unique per-line project rows", () => {
  assert.throws(
    () => validateAllocationBody(itemizedBody({ allocations: [
      { lineNumber: 1, projectID: PROJECT_A, quantity: 25 },
      { lineNumber: 1, projectID: PROJECT_A, quantity: 25 },
    ] })),
    (error) => error.status === 400 && /only one allocation row per project/.test(error.message)
  );
  assert.throws(
    () => validateAllocationBody(itemizedBody({ allocations: [
      { lineNumber: 1, projectID: PROJECT_A, quantity: 50 },
    ] })),
    (error) => error.status === 400 && /at least two distinct projects/.test(error.message)
  );
});

test("rejects invalid project IDs, quantities, dates, categories, and centavos", () => {
  assert.throws(
    () => validateAllocationBody(itemizedBody({ allocations: [
      { lineNumber: 1, projectID: "not-a-uuid", quantity: 30 },
      { lineNumber: 1, projectID: PROJECT_B, quantity: 20 },
    ] })),
    (error) => error.status === 400 && /valid UUID/.test(error.message)
  );
  assert.throws(() => parseQuantityHundredths(0.001, "quantity"), (error) => error.status === 400);
  assert.throws(() => parseMoneyCents(0.001, "amount"), (error) => error.status === 400);
  assert.throws(
    () => validateAllocationBody(itemizedBody({ receiptDate: "2026-02-30" })),
    (error) => error.status === 400 && /valid YYYY-MM-DD/.test(error.message)
  );
  assert.throws(
    () => validateAllocationBody(itemizedBody({ category: "Labor" })),
    (error) => error.status === 400 && /category must be one of/.test(error.message)
  );
});

test("allocation cents are stable when the client reorders project rows", () => {
  const original = validateAllocationBody(itemizedBody({ receiptTotal: 8251, adjustmentType: "tax" }));
  const reordered = validateAllocationBody(itemizedBody({
    receiptTotal: 8251,
    adjustmentType: "tax",
    allocations: [
      { lineNumber: 1, projectID: PROJECT_B, quantity: 20 },
      { lineNumber: 1, projectID: PROJECT_A, quantity: 30 },
    ],
  }));
  assert.deepEqual(projectAmounts(reordered), projectAmounts(original));
});

test("rejects project quantity totals that exceed Expenses.quantity storage range", () => {
  assert.throws(
    () => validateAllocationBody({
      ...COMMON,
      receiptTotal: 0,
      lineItems: [
        { lineNumber: 1, description: "Bulk item", quantity: 99999999.99, amount: 0 },
        { lineNumber: 2, description: "Bulk item", quantity: 1, amount: 0 },
      ],
      allocations: [
        { lineNumber: 1, projectID: PROJECT_A, quantity: 99999999.98 },
        { lineNumber: 1, projectID: PROJECT_B, quantity: 0.01 },
        { lineNumber: 2, projectID: PROJECT_A, quantity: 1 },
      ],
    }),
    (error) => error.status === 400 && /Total quantity allocated to project/.test(error.message)
  );
});

test("UTC008: largest remainder preserves a one-cent line total", () => {
  assert.deepEqual(distributeCents(1, [1, 1]), [1, 0]);
  assert.deepEqual(distributeCents(2, [1, 1, 1]), [1, 1, 0]);
});
