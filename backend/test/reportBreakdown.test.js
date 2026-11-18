// F11 "View breakdown": the rows behind each figure must add up to the report.
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildBreakdown, getReportBreakdown } = require("../src/lib/reportBreakdown");
const { buildSummary } = require("../src/lib/reportSummary");

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const PERIOD = { from: "2026-10-01", to: "2026-11-30" };

const rows = {
  projects: [{ projectId: P1, name: "Santos", budget: "100000.00" }],
  expenses: [
    { expenseId: "e2", projectId: P1, receiptDate: "2026-11-05", vendorName: "Cebu Hardware", birValidationStatus: "Formal-Tax-Deductible", amount: "3000.50" },
    { expenseId: "e1", projectId: P1, receiptDate: "2026-09-20", vendorName: "Sari-sari", birValidationStatus: "Informal", amount: "1000.00" },
  ],
  milestones: [
    { projectId: P1, name: "Roofing", dueDate: "2026-12-20", completion: "0.00" },
    { projectId: P1, name: "Foundation", dueDate: "2026-10-10", completion: "100.00" },
    { projectId: P1, name: "Walls", dueDate: "2026-11-01", completion: "40.00" },
  ],
  excluded: [{ expenseId: "e3", projectId: P1, receiptDate: "2026-11-10", vendorName: "X", amount: "500", status: "Pending", fraudFlagged: false }],
};

test("expenses are sorted by date, amounts are numbers, inPeriod follows the chosen dates", () => {
  const b = buildBreakdown(rows, PERIOD, "2026-11-18");
  const e = b.projects[0].expenses;
  assert.deepEqual(e.map((x) => x.expenseId), ["e1", "e2"]);
  assert.equal(e[0].inPeriod, false); // before the period: counts in "to date" only
  assert.equal(e[1].inPeriod, true);
  assert.equal(e[1].amount, 3000.5);
});

test("the breakdown adds up to the same figures as the report summary", () => {
  const b = buildBreakdown(rows, PERIOD, "2026-11-18");
  const s = buildSummary(
    [{ projectId: P1, name: "Santos", budget: "100000.00", progress: "46.67" }],
    rows.expenses, [], new Date("2026-11-18T00:00:00Z"), PERIOD
  );
  const sum = (list) => Math.round(list.reduce((t, x) => t + x.amount * 100, 0)) / 100;
  const e = b.projects[0].expenses;
  assert.equal(sum(e), s.projects[0].cumulativeSpend);
  assert.equal(sum(e.filter((x) => x.inPeriod)), s.projects[0].periodSpend);
  assert.equal(sum(e.filter((x) => x.inPeriod && x.birValidationStatus === "Formal-Tax-Deductible")), s.projects[0].birDeductibleSpend);
});

test("a milestone is overdue when its due date has passed and it is not 100%", () => {
  const ms = buildBreakdown(rows, PERIOD, "2026-11-18").projects[0].milestones;
  assert.deepEqual(ms.map((m) => [m.name, m.overdue]), [["Foundation", false], ["Walls", true], ["Roofing", false]]);
});

test("overdue is judged on the end date, never later than today", () => {
  const early = buildBreakdown(rows, { from: "2026-10-01", to: "2026-10-31" }, "2026-11-18");
  assert.equal(early.asOf, "2026-10-31");
  assert.equal(early.projects[0].milestones.find((m) => m.name === "Walls").overdue, false);
  const future = buildBreakdown(rows, { from: "2026-10-01", to: "2027-04-30" }, "2026-11-18");
  assert.equal(future.asOf, "2026-11-18");
});

test("pending and fraud-flagged expenses are listed separately, not in the spend", () => {
  const p = buildBreakdown(rows, PERIOD, "2026-11-18").projects[0];
  assert.equal(p.excluded.length, 1);
  assert.ok(!p.expenses.some((x) => x.expenseId === "e3"));
});

test("getReportBreakdown asks only for Approved spend up to the end date, keeps the chosen order", async () => {
  const seen = [];
  const queryFn = async (sql, params) => {
    seen.push({ sql, params });
    if (sql.includes("FROM projects p")) return { rows: [{ projectId: P2, name: "B", budget: "1" }, { projectId: P1, name: "A", budget: "1" }] };
    return { rows: [] };
  };
  const b = await getReportBreakdown(queryFn, { projectIds: [P1, P2], ...PERIOD }, "2026-11-18");
  assert.deepEqual(b.projects.map((p) => p.projectId), [P1, P2]);
  const spend = seen.find((q) => q.sql.includes("e.status = 'Approved'"));
  assert.ok(spend.sql.includes("receiptdate <= $2::date"));
  assert.deepEqual(spend.params, [[P1, P2], PERIOD.to]);
  assert.ok(seen.every((q) => !/insert|update|delete/i.test(q.sql)));
});
