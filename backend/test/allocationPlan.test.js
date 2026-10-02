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

test("excess: 70 bags leave 10 bags (₱2,800) uncovered and block submit", () => {
  const result = plan([cement(70, 19600)]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.uncovered, [{ lineIndex: 0, description: "Portland cement 40kg", quantityH: 1000, amountCents: 280000 }]);
  assert.match(describePlanProblems(result)[0], /No open request for 10 more of "Portland cement 40kg"/);
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

test("only one portion gives ok = false (use the F6 flow instead)", () => {
  const result = plan([cement(20, 5600)]);
  assert.equal(result.ok, false);
  assert.equal(result.portions.length, 1);
  assert.deepEqual(describePlanProblems(result), ["This receipt covers one request. Submit it from that request instead."]);
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
    { type: "OVER_BUDGET", ticketID: ALPHA, amountCents: 610000, remainingBudgetCents: 500000 },
  ]);
  assert.equal(result.portions[0].overBudget, true);
  assert.equal(result.portions[1].overBudget, false); // no budget given: not checked
});
