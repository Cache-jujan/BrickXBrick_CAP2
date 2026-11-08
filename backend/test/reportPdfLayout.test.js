const test = require("node:test");
const assert = require("node:assert/strict");
const { buildReportDocDefinition } = require("../src/lib/reportPdf");

const project = (n, over = {}) => ({
  projectId: `p${n}`, name: `Project ${n}`, budget: 1000, periodSpend: 100, cumulativeSpend: 300,
  netPnL: 700, costVariance: -900, varianceToDate: -700, varianceToDatePct: -70, utilizationPct: 10, cumulativeUtilizationPct: 30,
  progressPct: 35, overrun: false, health: "ok", birDeductibleSpend: 50, monthlySpend: [40, 60], ...over,
});
const totals = {
  budget: 2000, periodSpend: 200, cumulativeSpend: 600, netPnL: 1400, costVariance: -1800, varianceToDate: -1400, varianceToDatePct: -70,
  utilizationPct: 10, cumulativeUtilizationPct: 30, progressPct: 35, overrun: false, health: "ok", birDeductibleSpend: 100, monthlySpend: [80, 120],
};
const make = (projects, extra = {}) => ({
  generatedAt: "2026-10-21T00:00:00.000Z", period: { from: "2026-09-15", to: "2026-10-21" }, empty: false, watchGapPoints: 10,
  months: ["2026-09", "2026-10"], projects, totals, warnings: { pendingExpenses: 0, fraudFlaggedExpenses: 0 }, ...extra,
});
const options = { reportId: "r1", payloadHash: "h", anchor: { status: "Pending" }, generatedByName: "Tester" };

const tables = (doc) => doc.content.filter((c) => c.table);
const mainTable = (doc) => tables(doc).find((c) => c.table.body[0].length === 8).table.body;
const sectionTitles = (doc) => doc.content.filter((c) => c.style === "section").map((c) => c.text);
// Drawn bars in the middle column; the used/done chart ends in a Used/Done stack, the month chart in an amount.
const barTable = (doc) => tables(doc).find((c) => c.table.body[0][1].canvas && c.table.body[0][2].stack).table.body;
const monthTable = (doc) => tables(doc).find((c) => c.table.body[0][1].canvas && !c.table.body[0][2].stack).table.body;
const allText = (node) => JSON.stringify(node);

test("PDF: no picture from the browser; the charts are drawn as shapes", () => {
  const doc = buildReportDocDefinition(make([project(1), project(2)]), options);
  assert.ok(!allText(doc.content).includes('"image"'));
  assert.ok(barTable(doc).every((row) => Array.isArray(row[1].canvas)));
});

test("PDF, several projects: the main table has every figure, a Total row, and one basis (spend to date)", () => {
  const doc = buildReportDocDefinition(make([project(1), project(2)]), options);
  const body = mainTable(doc);
  assert.deepEqual(body[0].map((c) => c.text), ["Project", "Budget", "Spent this period", "Spent to date", "Budget left\n(Net P&L)", "Budget used", "Work done", "Status"]);
  assert.equal(body.length, 4); // header + 2 projects + total
  assert.equal(body[1][4].text, "700.00"); // budget left = 1000 - 300 to date
  assert.equal(body[1][5].text, "30.0%");
  assert.equal(body[1][6].text, "35.0%");
  assert.equal(body[3][0].text, "Total");
});

test("PDF: a project over budget to date says Over budget, even when this period's spend alone was small", () => {
  const over = project(2, { periodSpend: 100, cumulativeSpend: 1040, netPnL: -40, cumulativeUtilizationPct: 104, overrun: true, health: "over" });
  const body = mainTable(buildReportDocDefinition(make([project(1), over]), options));
  assert.equal(body[2][7].text, "Over budget");
  assert.equal(body[2][4].text, "-40.00");
  assert.equal(body[2][4].color, "#a23223");
});

test("PDF: Watch status and a line naming the project when budget used runs ahead of work done", () => {
  const watch = project(2, { cumulativeUtilizationPct: 60, progressPct: 40, health: "watch" });
  const doc = buildReportDocDefinition(make([project(1), watch]), options);
  assert.equal(mainTable(doc)[2][7].text, "Watch");
  assert.ok(doc.content.some((c) => typeof c.text === "string" && c.text.startsWith("Watch: Project 2.")));
});

test("PDF: a summary saved before status existed still shows Over budget from overrun", () => {
  const old = project(1, { overrun: true, health: undefined });
  assert.equal(mainTable(buildReportDocDefinition(make([old, project(2)]), options))[1][7].text, "Over budget");
});

test("PDF: budget used vs work done has a row per project and one for all of them; no milestones says so", () => {
  const doc = buildReportDocDefinition(make([project(1), project(2, { progressPct: null })]), options);
  const body = barTable(doc);
  assert.deepEqual(body.map((row) => row[0].text), ["Project 1", "Project 2", "All projects (weighted by budget)"]);
  assert.ok(allText(body[1][2]).includes("no milestones"));
});

test("PDF: spending by month has one row per month with its total", () => {
  const body = monthTable(buildReportDocDefinition(make([project(1), project(2)]), options));
  assert.deepEqual(body.map((row) => row[0].text), ["Sep 2026", "Oct 2026"]);
  assert.deepEqual(body.map((row) => row[2].text), ["80.00", "120.00"]);
});

test("PDF, one project: no Total rows, BIR as a sentence, sections in order", () => {
  const doc = buildReportDocDefinition(make([project(1)]), options);
  assert.equal(mainTable(doc).length, 2); // header + the project
  assert.equal(barTable(doc).length, 1);
  assert.deepEqual(sectionTitles(doc), ["Budget and spend", "Budget used vs work done", "Spending by month", "BIR tax-deductible spend (Formal receipts only)", "How to read this report"]);
  const sentence = doc.content.find((c) => Array.isArray(c.text) && String(c.text[1]).includes("tax-deductible"));
  assert.equal(sentence.text[0].text, "PHP 50.00");
});

test("PDF: integrity warnings appear only when there is something to warn about", () => {
  const quiet = buildReportDocDefinition(make([project(1)]), options);
  assert.ok(!sectionTitles(quiet).includes("Integrity warnings"));
  const noisy = buildReportDocDefinition(make([project(1)], { warnings: { pendingExpenses: 2, fraudFlaggedExpenses: 0 } }), options);
  assert.ok(sectionTitles(noisy).includes("Integrity warnings"));
});
