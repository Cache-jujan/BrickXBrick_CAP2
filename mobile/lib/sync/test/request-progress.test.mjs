import test from "node:test";
import assert from "node:assert/strict";
import { matchedQuantity, receiptProgress, receiptTotalQuantity, quantityFieldsFromTicket } from "../../request-progress.js";
import { budgetIssue } from "../../budget-check.js";

const ticket = { ticketId: "t1", materialType: "Cement", bomItemID: null };

test("only the lines for the requested material are counted", () => {
  const lines = [
    { description: "Portland cement 40kg", quantity: 5 },
    { description: "Washed sand", quantity: 15 },
    { description: "Delivery fee", quantity: 0 },
  ];
  assert.equal(matchedQuantity(lines, ticket), 5);
  assert.equal(receiptTotalQuantity(lines), 20);
  assert.equal(matchedQuantity([{ description: "Sand", quantity: 3 }], ticket), null);
  assert.equal(matchedQuantity([{ description: "Cement" }], ticket), null);
});

test("a part purchase leaves the request open with what is still to buy", () => {
  const p = receiptProgress({ requested: 10, remaining: 10, thisQuantity: 5 });
  assert.equal(p.completes, false);
  assert.equal(p.leftAfter, 5);
  assert.equal(p.afterShare, 0.5);
});

test("the purchase that brings what is left to 0 completes it; more than that is flagged as over", () => {
  assert.equal(receiptProgress({ requested: 10, remaining: 5, thisQuantity: 5 }).completes, true);
  const over = receiptProgress({ requested: 10, remaining: 5, thisQuantity: 7 });
  assert.equal(over.over, true);
  assert.equal(over.leftAfter, 0);
});

test("no quantities on hand: no bar", () => {
  assert.equal(receiptProgress({ requested: undefined, remaining: undefined, thisQuantity: 3 }), null);
});

test("a part purchase under budget needs no note; the last one does", () => {
  assert.equal(budgetIssue({ amount: 500, remaining: "2000", note: "", completes: false }), null);
  assert.equal(budgetIssue({ amount: 500, remaining: "2000", note: "", completes: true }).code, "note");
});

test("a ticket row gives the quantity fields from what is already bought", () => {
  const f = quantityFieldsFromTicket({ quantity: "10", expensequantity: "4", materialtype: "Cement", unit: "bags" });
  assert.equal(f.requestedQuantity, 10);
  assert.equal(f.remainingQuantity, 6);
});
