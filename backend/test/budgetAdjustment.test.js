// The Purchaser's budget-adjustment ticket: input rules and the words the Project Manager reads.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  REASONS,
  validateAdjustmentBody,
  describeAdjustment,
  validateRejectionReason,
} = require("../src/lib/budgetAdjustment");

const ID = "ef403363-8377-46ee-902f-54634c558356";
const ok = { ticketID: ID, requestedAmount: 300, reasonCode: "supplier_price_increase" };

test("a valid ask returns centavos, the reason and a trimmed note", () => {
  const v = validateAdjustmentBody({ ...ok, requestedAmount: 300.5, note: "  Price went up  " });
  assert.deepEqual(v, { ticketID: ID, requestedCents: 30050, reasonCode: "supplier_price_increase", note: "Price went up" });
});

test("the amount must be more than zero, with at most two decimals", () => {
  assert.throws(() => validateAdjustmentBody({ ...ok, requestedAmount: 0 }), /more than zero/);
  assert.throws(() => validateAdjustmentBody({ ...ok, requestedAmount: -5 }), /non-negative/);
  assert.throws(() => validateAdjustmentBody({ ...ok, requestedAmount: 1.234 }), /two decimal/);
  assert.throws(() => validateAdjustmentBody({ ...ok, requestedAmount: "300" }), /finite/);
});

test("the request id and the reason must be valid", () => {
  assert.throws(() => validateAdjustmentBody({ ...ok, ticketID: "nope" }), /valid request id/);
  assert.throws(() => validateAdjustmentBody({ ...ok, reasonCode: "because" }), /Pick a reason/);
  assert.throws(() => validateAdjustmentBody({ ...ok, reasonCode: undefined }), /Pick a reason/);
});

test("every reason has words, and 'other' needs a note", () => {
  for (const code of Object.keys(REASONS)) assert.ok(REASONS[code].length > 3);
  assert.throws(() => validateAdjustmentBody({ ...ok, reasonCode: "other" }), /Say what the reason is/);
  assert.doesNotThrow(() => validateAdjustmentBody({ ...ok, reasonCode: "other", note: "Site change" }));
  assert.throws(() => validateAdjustmentBody({ ...ok, note: "x".repeat(301) }), /300 characters/);
});

test("the ticket text tells the PM the material, project, amounts, new budget and reason", () => {
  const text = describeAdjustment({
    materialType: "Cement", projectName: "Santos Residence", requestedCents: 30000, currentBudgetCents: 260000,
    reasonCode: "supplier_price_increase", note: "New price list",
  });
  assert.match(text, /Cement \(Santos Residence\)/);
  assert.match(text, /Current approved budget: ₱2,600\.00/);
  assert.match(text, /Extra amount needed: ₱300\.00/);
  assert.match(text, /New budget if approved: ₱2,900\.00/);
  assert.match(text, /The supplier raised the price/);
  assert.match(text, /Note: New price list/);
});

test("a rejection needs a readable reason", () => {
  assert.equal(validateRejectionReason("  Over what the client allows "), "Over what the client allows");
  assert.throws(() => validateRejectionReason("   "), /reason/);
  assert.throws(() => validateRejectionReason(undefined), /reason/);
});
