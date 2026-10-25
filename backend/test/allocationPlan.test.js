// F8 split algorithm tests (allocationPlan.js). No database needed.
const test = require("node:test");
const assert = require("node:assert/strict");
const { planAllocation, describePlanProblems } = require("../src/lib/allocationPlan");

// Simple fake matcher so these tests don't depend on Jan's exact rules.
const fakeMatch = (description, materialType) =>
  description.toLowerCase().includes(String(materialType).toLowerCase());

const ALPHA = "00000000-0000-4000-8000-00000000000a";
const BRAVO = "00000000-0000-4000-8000-00000000000b";
const CHARLIE = "00000000-0000-4000-8000-00000000000c";

function cementTickets() {
  return [
    // Deliberately out of order: the plan must sort oldest first.
    { ticketID: CHARLIE, projectID: "p-c", projectName: "Project Charlie", materialType: "cement", remainingQuantity: "10.00", createdAt: "2026-10-03T08:00:00Z" },
    { ticketID: ALPHA, projectID: "p-a", projectName: "Project Alpha", materialType: "cement", remainingQuantity: "20.00", createdAt: "2026-10-01T08:00:00Z" },
    { ticketID: BRAVO, projectID: "p-b", projectName: "Project Bravo", materialType: "cement", remainingQuantity: "30.00", createdAt: "2026-10-02T08:00:00Z" },
  ];
}

const cement = (bags, pesos) => ({ description: "Portland cement 40kg", quantity: bags, amount: pesos });
const delivery = { description: "Delivery fee", quantity: 0, amount: 500 };

const plan = (lines, tickets = cementTickets(), options = {}) => planAllocation(lines, tickets, options, fakeMatch);
const summary = (result) => result.portions.map((p) => [p.projectName, p.quantityH / 100, p.amountCents, p.resolvesTicket]);

test("exact cover: 60 bags fill all three requests; delivery rides on the oldest", () => {
  const result = plan([cement(60, 16800), delivery]);
  assert.equal(result.ok, true);
  assert.deepEqual(summary(result), [
    ["Project Alpha", 20, 610000, true],
    ["Project Bravo", 30, 840000, true],
    ["Project Charlie", 10, 280000, true],
  ]);
  assert.equal(result.allocatedCents, 1730000);
  assert.equal(result.linesCents, 1730000);
});

test("shortfall: 50 bags leave the newest request open with 10 remaining", () => {
  const result = plan([cement(50, 14000)]);
  assert.equal(result.ok, true);
  assert.deepEqual(summary(result), [
    ["Project Alpha", 20, 560000, true],
    ["Project Bravo", 30, 840000, true],
  ]);
  assert.equal(result.portions.some((p) => p.ticketID === CHARLIE), false);
});

test("45 bags: Bravo is partly filled and stays open", () => {
  const result = plan([cement(45, 12600)]);
  const bravo = result.portions.find((p) => p.ticketID === BRAVO);
  assert.equal(bravo.quantityH, 2500);
  assert.equal(bravo.remainingAfterH, 500);
  assert.equal(bravo.resolvesTicket, false);
});

test("excess: 70 bags still submit; the 10 extra bags (₱2,800) ride on the last request and are reported", () => {
  const result = plan([cement(70, 19600)]);
  assert.equal(result.ok, true);
  assert.deepEqual(describePlanProblems(result), []);
  assert.equal(result.extras.length, 1);
  assert.deepEqual(
    { quantityH: result.extras[0].quantityH, amountCents: result.extras[0].amountCents, ticketID: result.extras[0].ticketID },
    { quantityH: 1000, amountCents: 280000, ticketID: CHARLIE }
  );
  // Money still adds up: every peso of the receipt sits on a portion.
  assert.equal(result.allocatedCents, result.linesCents);
  const charlie = result.portions.find((p) => p.ticketID === CHARLIE);
  assert.equal(charlie.quantityH, 2000); // 10 it wanted + 10 extra
  assert.equal(charlie.extraH, 1000);
  assert.equal(charlie.remainingAfterH, 0);
  assert.equal(charlie.resolvesTicket, true);
  assert.deepEqual(result.warnings, [{ type: "OVER_QUANTITY", ticketID: CHARLIE, quantityH: 1000 }]);
});

test("a receipt that matches no request at all still cannot be submitted", () => {
  const result = plan([{ description: "Rebar 10mm", quantity: 5, amount: 1000 }]);
  assert.equal(result.ok, false);
  assert.equal(result.unmatched.length, 1);
});

test("over the budget but inside the allowance is a quiet warning; beyond it needs a reason", () => {
  const tickets = cementTickets();
  tickets.find((t) => t.ticketID === ALPHA).remainingBudget = "5800.00"; // spends 6,100: 5% over
  tickets.find((t) => t.ticketID === ALPHA).budgetAllowancePct = 10;
  const quiet = plan([cement(60, 16800), delivery], tickets);
  const alpha = quiet.portions.find((p) => p.ticketID === ALPHA);
  assert.equal(alpha.overBudget, true);
  assert.equal(alpha.overAllowance, false);

  tickets.find((t) => t.ticketID === ALPHA).remainingBudget = "5000.00"; // 22% over
  const loud = plan([cement(60, 16800), delivery], tickets);
  assert.equal(loud.portions.find((p) => p.ticketID === ALPHA).overAllowance, true);
});

test("allowance defaults to 10% when the project has none set", () => {
  const tickets = cementTickets();
  tickets.find((t) => t.ticketID === ALPHA).remainingBudget = "5500.00"; // 6,100 is 10.9% over
  assert.equal(plan([cement(60, 16800), delivery], tickets).portions.find((p) => p.ticketID === ALPHA).overAllowance, true);
  tickets.find((t) => t.ticketID === ALPHA).budgetAllowancePct = 15;
  assert.equal(plan([cement(60, 16800), delivery], tickets).portions.find((p) => p.ticketID === ALPHA).overAllowance, false);
});

test("FIFO order uses createdAt, then ticketID to break ties", () => {
  const sameTime = "2026-10-01T08:00:00Z";
  const tickets = [
    { ticketID: BRAVO, projectID: "p-b", projectName: "B", materialType: "cement", remainingQuantity: 10, createdAt: sameTime },
    { ticketID: ALPHA, projectID: "p-a", projectName: "A", materialType: "cement", remainingQuantity: 10, createdAt: sameTime },
    { ticketID: CHARLIE, projectID: "p-c", projectName: "C", materialType: "cement", remainingQuantity: 10, createdAt: "2026-09-30T08:00:00Z" },
  ];
  const result = plan([cement(15, 1500)], tickets);
  assert.deepEqual(result.portions.map((p) => [p.projectName, p.quantityH]), [["C", 1000], ["A", 500]]);
});

test("a partly filled request only takes what it still needs (5 of 20 remaining)", () => {
  const tickets = cementTickets();
  tickets.find((t) => t.ticketID === ALPHA).remainingQuantity = "5.00";
  const result = plan([cement(35, 9800)], tickets);
  assert.deepEqual(result.portions.map((p) => [p.projectName, p.quantityH / 100]), [["Project Alpha", 5], ["Project Bravo", 30]]);
});

test("two lines of the same material share one pool", () => {
  const result = plan([
    { description: "Portland cement 40kg", quantity: 25, amount: 7000 },
    { description: "Cement, Portland (promo)", quantity: 35, amount: 9800 },
  ]);
  assert.equal(result.ok, true);
  const alpha = result.portions.find((p) => p.ticketID === ALPHA);
  const bravo = result.portions.find((p) => p.ticketID === BRAVO);
  const charlie = result.portions.find((p) => p.ticketID === CHARLIE);
  assert.equal(alpha.quantityH, 2000);
  assert.equal(bravo.quantityH, 3000); // 5 from line 0 + 25 from line 1
  assert.deepEqual(bravo.lines.map((l) => [l.lineIndex, l.quantityH]), [[0, 500], [1, 2500]]);
  assert.equal(charlie.quantityH, 1000);
});

test("rounding: ₱100.00 for 3 units split 1/1/1 gives 33.33 + 33.33 + 33.34", () => {
  const tickets = cementTickets().map((t) => ({ ...t, remainingQuantity: 1 }));
  const result = plan([cement(3, 100)], tickets);
  assert.deepEqual(result.portions.map((p) => p.amountCents), [3333, 3333, 3334]);
  assert.equal(result.allocatedCents, 10000);
});

test("feeTargets moves the delivery line to another portion", () => {
  const result = plan([cement(60, 16800), delivery], cementTickets(), { feeTargets: { 1: BRAVO } });
  assert.deepEqual(result.portions.map((p) => p.amountCents), [560000, 890000, 280000]);
  assert.deepEqual(result.portions[1].lines.map((l) => l.description), ["Portland cement 40kg", "Delivery fee"]);
});

test("a line with no matching request goes to unmatched and blocks submit", () => {
  const result = plan([cement(60, 16800), { description: "Common nails", quantity: 5, amount: 250 }]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.unmatched.map((u) => u.description), ["Common nails"]);
  assert.match(describePlanProblems(result)[0], /No open request for 5 of "Common nails"/);
});

test("an excluded request gets nothing; the next one fills instead", () => {
  const result = plan([cement(40, 11200)], cementTickets(), { excludeTicketIDs: [ALPHA] });
  assert.deepEqual(result.portions.map((p) => [p.projectName, p.quantityH / 100]), [["Project Bravo", 30], ["Project Charlie", 10]]);
});

test("a line without a quantity is rejected with 400", () => {
  assert.throws(
    () => plan([{ description: "Portland cement 40kg", amount: 100 }]),
    (error) => error.status === 400 && /quantity is required/.test(error.message)
  );
});

test("a receipt that covers a single request is a valid plan", () => {
  const result = plan([cement(20, 5600)]);
  assert.equal(result.ok, true);
  assert.equal(result.portions.length, 1);
  assert.deepEqual(describePlanProblems(result), []);
});

test("two requests from the SAME project are two portions and allowed", () => {
  const tickets = [
    { ticketID: ALPHA, projectID: "p-a", projectName: "Project Alpha", materialType: "cement", remainingQuantity: 20, createdAt: "2026-10-01T08:00:00Z" },
    { ticketID: BRAVO, projectID: "p-a", projectName: "Project Alpha", materialType: "cement", remainingQuantity: 10, createdAt: "2026-10-02T08:00:00Z" },
  ];
  const result = plan([cement(30, 8400)], tickets);
  assert.equal(result.ok, true);
  assert.equal(result.portions.length, 2);
});

test("a fee line with no material portions at all is unmatched", () => {
  const result = plan([delivery]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.unmatched.map((u) => u.description), ["Delivery fee"]);
});

test("over-budget portions produce a warning but do not block the plan", () => {
  const tickets = cementTickets();
  tickets.find((t) => t.ticketID === ALPHA).remainingBudget = "5000.00";
  const result = plan([cement(60, 16800), delivery], tickets);
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, [
    { type: "OVER_BUDGET", ticketID: ALPHA, amountCents: 610000, remainingBudgetCents: 500000, overAllowance: true },
  ]);
  assert.equal(result.portions[0].overBudget, true);
  assert.equal(result.portions[1].overBudget, false); // no budget given: not checked
});

test("default matcher is F9's matchesMaterial (no fake passed)", () => {
  const result = planAllocation([cement(60, 16800), delivery], cementTickets());
  assert.equal(result.ok, true);
  assert.equal(result.portions.length, 3);
});

test("the PM note names what the system noticed and keeps the Purchaser's own words", () => {
  const { submitNoteFor } = require("../src/lib/allocationPlan");
  assert.equal(submitNoteFor({ extraH: 0, overAllowance: false }, null), null);
  assert.equal(
    submitNoteFor({ extraH: 1000, materialType: "cement", overAllowance: false }, "Store had a promo"),
    "Bought 10 more cement than requested. Purchaser's reason: Store had a promo"
  );
  assert.match(
    submitNoteFor({ extraH: 0, overAllowance: true, amountCents: 610000, remainingBudgetCents: 500000, allowancePct: 10 }, null),
    /Spent ₱6100.00 with ₱5000.00 left, beyond the 10% allowance./
  );
});

test("closing a request short needs a reason of reasonable length", () => {
  const { validateCloseShortReason } = require("../src/lib/allocationValidation");
  assert.equal(validateCloseShortReason("  Budget ran out  "), "Budget ran out");
  assert.throws(() => validateCloseShortReason("   "), (e) => e.status === 400);
  assert.throws(() => validateCloseShortReason(undefined), (e) => e.status === 400);
  assert.throws(() => validateCloseShortReason("x".repeat(301)), (e) => e.status === 400);
});

// ---- Matched by hand (lineTargets) ---------------------------------------------------------

const { submitNoteFor } = require("../src/lib/allocationPlan");

test("a line matched by hand goes to that request even when the words do not match", () => {
  const result = plan([{ description: "Sand and gravel mix", quantity: 5, amount: 1000 }], cementTickets(), { lineTargets: { 0: BRAVO } });
  assert.equal(result.ok, true);
  assert.deepEqual(summary(result), [["Project Bravo", 5, 100000, false]]);
  assert.equal(result.portions[0].lines[0].manual, true);
});

test("a hand match is capped by what the request still wants; the rest is an extra on it", () => {
  const result = plan([{ description: "Mystery bags", quantity: 12, amount: 1200 }], cementTickets(), { lineTargets: { 0: CHARLIE } });
  assert.equal(result.portions.length, 1);
  assert.equal(result.portions[0].quantityH, 1200);
  assert.equal(result.portions[0].extraH, 200);
  assert.equal(result.portions[0].resolvesTicket, true);
});

test("a delivery fee alone can be matched to a request", () => {
  const result = plan([delivery], cementTickets(), { lineTargets: { 0: ALPHA } });
  assert.equal(result.ok, true);
  assert.deepEqual(summary(result), [["Project Alpha", 0, 50000, false]]);
  assert.equal(result.portions[0].remainingAfterH, 2000);
});

test("a delivery fee with no target still blocks when nothing matched", () => {
  assert.equal(plan([delivery]).ok, false);
});

test("a target that is excluded falls back to normal matching", () => {
  const result = plan([cement(5, 1000)], cementTickets(), { excludeTicketIDs: [BRAVO], lineTargets: { 0: BRAVO } });
  assert.equal(result.ok, true);
  assert.equal(result.portions[0].ticketID, ALPHA);
  assert.equal(result.portions[0].lines[0].manual, undefined);
});

test("the PM note says what was matched by hand", () => {
  const result = plan([{ description: "Mystery bags", quantity: 3, amount: 300 }], cementTickets(), { lineTargets: { 0: ALPHA } });
  assert.match(submitNoteFor(result.portions[0], null), /Matched by hand to this request: Mystery bags\./);
});
