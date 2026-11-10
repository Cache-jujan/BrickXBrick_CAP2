// The strict budget rules: no purchase without an approved budget, never above what is
// left, and a written reason when the request is finished with money to spare.
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkBudget, budgetIssuesFor, loadRemainingBudgetCents, SUBMIT_NOTE_MAX } = require("../src/lib/ticketBudget");

const ok = { amountCents: 500000, remainingBudgetCents: 1000000, completesRequest: false, note: "", label: "Cement" };

test("inside the budget and not finishing the request: fine without a note", () => {
  assert.equal(checkBudget(ok), null);
});

test("exactly the remaining budget is allowed", () => {
  assert.equal(checkBudget({ ...ok, amountCents: 1000000, completesRequest: true }), null);
});

test("one centavo over the remaining budget is refused as OVER_BUDGET", () => {
  const issue = checkBudget({ ...ok, amountCents: 1000001 });
  assert.equal(issue.code, "OVER_BUDGET");
  assert.match(issue.message, /Cement/);
  assert.match(issue.message, /10,000\.01/);
  assert.match(issue.message, /10,000\.00/);
});

test("a request with no approved budget cannot be bought against", () => {
  const issue = checkBudget({ ...ok, remainingBudgetCents: null });
  assert.equal(issue.code, "NO_APPROVED_BUDGET");
});

test("a zero approved budget refuses any amount above zero", () => {
  assert.equal(checkBudget({ ...ok, remainingBudgetCents: 0 }).code, "OVER_BUDGET");
});

test("finishing the request below the remaining budget needs a note", () => {
  const issue = checkBudget({ ...ok, completesRequest: true });
  assert.equal(issue.code, "UNDERSPEND_NOTE_REQUIRED");
  assert.equal(checkBudget({ ...ok, completesRequest: true, note: "  " }).code, "UNDERSPEND_NOTE_REQUIRED");
  assert.equal(checkBudget({ ...ok, completesRequest: true, note: "Supplier gave a discount" }), null);
});

test("budgetIssuesFor checks every portion and names the one with the problem", () => {
  const portions = [
    { ticketID: "t1", materialType: "Cement", amountCents: 100, remainingBudgetCents: 1000, resolvesTicket: false },
    { ticketID: "t2", materialType: "Sand", amountCents: 2000, remainingBudgetCents: 1000, resolvesTicket: true },
  ];
  const issues = budgetIssuesFor(portions, "");
  assert.deepEqual(issues.map((i) => [i.ticketID, i.code]), [["t2", "OVER_BUDGET"]]);
});

test("budgetIssuesFor: the receipt's one note covers every finished portion", () => {
  const portions = [
    { ticketID: "t1", materialType: "Cement", amountCents: 100, remainingBudgetCents: 1000, resolvesTicket: true },
    { ticketID: "t2", materialType: "Sand", amountCents: 200, remainingBudgetCents: 1000, resolvesTicket: true },
  ];
  assert.equal(budgetIssuesFor(portions, "").length, 2);
  assert.equal(budgetIssuesFor(portions, "Discount").length, 0);
});

test("loadRemainingBudgetCents: approved minus spend that is not Rejected; null without a budget", async () => {
  const run = (rows) => async (sql, params) => {
    assert.match(sql, /e\.status <> 'Rejected'/);
    assert.deepEqual(params, ["t1", null]);
    return { rowCount: rows.length, rows };
  };
  assert.equal(await loadRemainingBudgetCents(run([{ remaining: "7500.50" }]), "t1"), 750050);
  assert.equal(await loadRemainingBudgetCents(run([{ remaining: null }]), "t1"), null);
  assert.equal(await loadRemainingBudgetCents(run([]), "t1"), null);
});

test("the note limit matches the stored column rule", () => {
  assert.equal(SUBMIT_NOTE_MAX, 300);
});

// ---- with a real split plan ---------------------------------------------------------

const { planAllocation } = require("../src/lib/allocationPlan");
const fakeMatch = (description, materialType) => description.toLowerCase().includes(String(materialType).toLowerCase());
const openCement = (id, quantity, remainingBudget, createdAt) => ({
  ticketID: id, projectID: `p-${id}`, projectName: `Project ${id}`, materialType: "cement",
  remainingQuantity: quantity, remainingBudget, createdAt,
});

test("split plan: a portion above its request's remaining budget is flagged; the other is fine", () => {
  const tickets = [openCement("a", "20.00", "5000.00", "2026-10-01T08:00:00Z"), openCement("b", "30.00", "9000.00", "2026-10-02T08:00:00Z")];
  const plan = planAllocation([{ description: "Portland cement", quantity: 50, amount: 14000 }], tickets, {}, fakeMatch);
  assert.equal(plan.ok, true);
  // a gets 20 bags = 5,600.00 against 5,000.00 left; b gets 30 bags = 8,400.00 against 9,000.00 left (finished, under budget)
  const issues = budgetIssuesFor(plan.portions, "Cheaper per bag");
  assert.deepEqual(issues.map((i) => [i.ticketID, i.code]), [["a", "OVER_BUDGET"]]);
});

test("split plan: a request with no approved budget (null) is flagged", () => {
  const plan = planAllocation([{ description: "Portland cement", quantity: 10, amount: 2800 }], [openCement("a", "20.00", null, "2026-10-01T08:00:00Z")], {}, fakeMatch);
  assert.deepEqual(budgetIssuesFor(plan.portions, "").map((i) => i.code), ["NO_APPROVED_BUDGET"]);
});
