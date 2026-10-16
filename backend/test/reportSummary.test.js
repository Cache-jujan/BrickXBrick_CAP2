// F11 summary math tests (reportSummary.js). Pure functions, no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSummary } = require("../src/lib/reportSummary");

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-16T01:00:00.000Z");
const PERIOD = { from: "2026-10-01", to: "2026-10-31" };
const FORMAL = "Formal-Tax-Deductible";

const project = (projectId, budget, name = "Project") => ({ projectId, name, budget });
const spend = (projectId, amount, receiptDate = "2026-10-10", birValidationStatus = "Informal") => ({
  projectId,
  amount,
  receiptDate,
  birValidationStatus,
});
const build = (projects, rows, warnings = [], period = PERIOD) =>
  buildSummary(projects, rows, warnings, NOW, period);

test("three approved expenses 5000, 7000, 3000 against budget 50000 (UT-C009 style)", () => {
  const summary = build([project(P1, "50000.00")], [spend(P1, "5000.00"), spend(P1, "7000.00"), spend(P1, "3000.00")]);
  const [row] = summary.projects;
  assert.equal(row.periodSpend, 15000);
  assert.equal(row.netPnL, 35000);
  assert.equal(row.utilizationPct, 30);
  assert.equal(row.overrun, false);
  assert.equal(row.costVariance, -35000);
  assert.equal(summary.empty, false);
  assert.equal(summary.generatedAt, "2026-10-16T01:00:00.000Z");
});

test("overrun: spend above budget gives overrun true and negative net", () => {
  const [row] = build([project(P1, 10000)], [spend(P1, 12500.5)]).projects;
  assert.equal(row.overrun, true);
  assert.equal(row.netPnL, -2500.5);
  assert.equal(row.costVariance, 2500.5);
  assert.equal(row.utilizationPct, 125.01);
});

test("budget 0 gives null utilization, no crash or Infinity", () => {
  const summary = build([project(P1, 0)], [spend(P1, 100)]);
  assert.equal(summary.projects[0].utilizationPct, null);
  assert.equal(summary.projects[0].cumulativeUtilizationPct, null);
  assert.equal(summary.totals.utilizationPct, null);
  assert.equal(summary.projects[0].overrun, true);
});

test("empty rows gives empty: true and zero figures", () => {
  const summary = build([project(P1, 50000)], []);
  assert.equal(summary.empty, true);
  assert.equal(summary.projects[0].periodSpend, 0);
  assert.equal(summary.projects[0].netPnL, 50000);
});

test("only rows outside the period also gives empty: true", () => {
  const summary = build([project(P1, 50000)], [spend(P1, 900, "2026-09-15")]);
  assert.equal(summary.empty, true);
  assert.equal(summary.projects[0].cumulativeSpend, 900);
});

test("BIR total counts only Formal-Tax-Deductible", () => {
  const summary = build(
    [project(P1, 50000)],
    [spend(P1, 4000, "2026-10-02", FORMAL), spend(P1, 1000, "2026-10-03", "Informal"), spend(P1, 500, "2026-10-04", FORMAL)]
  );
  assert.equal(summary.projects[0].periodSpend, 5500);
  assert.equal(summary.projects[0].birDeductibleSpend, 4500);
  assert.equal(summary.totals.birDeductibleSpend, 4500);
});

test("period spend and cumulative spend differ when expenses fall outside the range", () => {
  const summary = build(
    [project(P1, 20000)],
    [
      spend(P1, 1000, "2026-09-30"), // before the range: cumulative only
      spend(P1, 2000, "2026-10-01"), // first day, inclusive
      spend(P1, 3000, "2026-10-31"), // last day, inclusive
      spend(P1, 4000, "2026-11-01"), // after the range: ignored
    ]
  );
  const [row] = summary.projects;
  assert.equal(row.periodSpend, 5000);
  assert.equal(row.cumulativeSpend, 6000);
  assert.equal(row.utilizationPct, 25);
  assert.equal(row.cumulativeUtilizationPct, 30);
});

test("split receipt of 4500 into 2000 and 2500 across two projects counts 4500 once", () => {
  // allocations.js saves one expense per project portion (decision D1).
  const summary = build([project(P1, 10000), project(P2, 10000)], [spend(P1, "2000.00"), spend(P2, "2500.00")]);
  assert.equal(summary.projects[0].periodSpend, 2000);
  assert.equal(summary.projects[1].periodSpend, 2500);
  assert.equal(summary.totals.periodSpend, 4500);
});

test("totals add budgets and spend across projects", () => {
  const summary = build([project(P1, 30000), project(P2, 20000)], [spend(P1, 9000), spend(P2, 1000)]);
  assert.equal(summary.totals.budget, 50000);
  assert.equal(summary.totals.periodSpend, 10000);
  assert.equal(summary.totals.netPnL, 40000);
  assert.equal(summary.totals.utilizationPct, 20);
});

test("centavo sums do not drift (0.10 + 0.20)", () => {
  const [row] = build([project(P1, 100)], [spend(P1, "0.10"), spend(P1, "0.20")]).projects;
  assert.equal(row.periodSpend, 0.3);
});

test("rows for projects that were not requested are ignored", () => {
  const summary = build([project(P1, 1000)], [spend(P2, 999)]);
  assert.equal(summary.totals.periodSpend, 0);
});

test("warnings count Pending and fraud-flagged expenses in the range", () => {
  const summary = build(
    [project(P1, 1000)],
    [spend(P1, 10)],
    [
      { status: "Pending", fraudFlagged: false },
      { status: "Pending", fraudFlagged: true },
      { status: "Approved", fraudFlagged: true },
      { status: "Rejected", fraudFlagged: false },
    ]
  );
  assert.deepEqual(summary.warnings, { pendingExpenses: 2, fraudFlaggedExpenses: 2 });
});

test("a bad amount throws instead of producing NaN", () => {
  assert.throws(() => build([project(P1, 1000)], [spend(P1, "abc")]), /not a valid amount/);
});
