import test from "node:test";
import assert from "node:assert/strict";
import { remainingBudgetText, budgetIssue } from "../../budget-check.js";

test("remaining = approved budget minus spend so far; undefined without a budget", () => {
  assert.equal(remainingBudgetText({ approvedbudget: "10000.00", expensetotal: "2500.50" }), "7499.50");
  assert.equal(remainingBudgetText({ approvedbudget: 5000 }), "5000.00");
  assert.equal(remainingBudgetText({ approvedbudget: null }), undefined);
  assert.equal(remainingBudgetText(undefined), undefined);
});

test("floats do not drift: 0.1 + 0.2 style sums are done in centavos", () => {
  assert.equal(remainingBudgetText({ approvedbudget: "0.30", expensetotal: "0.10" }), "0.20");
});

test("no approved budget blocks the purchase", () => {
  assert.deepEqual(budgetIssue({ amount: 100, remaining: undefined }), { code: "none", remaining: null });
});

test("an amount above what is left is over, even by one centavo", () => {
  assert.deepEqual(budgetIssue({ amount: 1000.01, remaining: "1000.00", note: "x" }), { code: "over", remaining: 1000 });
});

test("exactly what is left passes with no note", () => {
  assert.equal(budgetIssue({ amount: 1000, remaining: "1000.00" }), null);
});

test("under what is left needs a note; blank spaces do not count", () => {
  assert.equal(budgetIssue({ amount: 900, remaining: "1000.00" }).code, "note");
  assert.equal(budgetIssue({ amount: 900, remaining: "1000.00", note: "   " }).code, "note");
  assert.equal(budgetIssue({ amount: 900, remaining: "1000.00", note: "Discount" }), null);
});
