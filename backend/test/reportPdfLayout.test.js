const test = require("node:test");
const assert = require("node:assert/strict");
const { buildReportDocDefinition } = require("../src/lib/reportPdf");

const project = (n, over = {}) => ({
  projectId: `p${n}`, name: `Project ${n}`, budget: 1000, periodSpend: 100, cumulativeSpend: 300,
  netPnL: 900, costVariance: -900, varianceToDate: -700, varianceToDatePct: -70, utilizationPct: 10, cumulativeUtilizationPct: 30, overrun: false, birDeductibleSpend: 50, ...over,
});
const totals = { budget: 2000, periodSpend: 200, cumulativeSpend: 600, netPnL: 1800, costVariance: -1800, varianceToDate: -1400, varianceToDatePct: -70, utilizationPct: 10, cumulativeUtilizationPct: 30, overrun: false, birDeductibleSpend: 100 };
const make = (projects) => ({
  generatedAt: "2026-10-21T00:00:00.000Z", period: { from: "2026-10-01", to: "2026-10-21" }, empty: false,
  projects, totals, warnings: { pendingExpenses: 0, fraudFlaggedExpenses: 0 },
});
const options = { reportId: "r1", payloadHash: "h", anchor: { status: "Pending" }, chartImage: "data:image/png;base64,AAAA", generatedByName: "Tester" };

const mainTable = (doc) => doc.content.find((c) => c.table && c.table.body[0].length === 7).table.body;
const texts = (doc) => doc.content.filter((c) => typeof c.text === "string").map((c) => c.text);

test("PDF, one project: no Total row, no separate BIR table, to-date wording", () => {
  const doc = buildReportDocDefinition(make([project(1)]), options);
  assert.equal(mainTable(doc).length, 2); // header + the project
  assert.ok(texts(doc).includes("Budget used to date"));
  assert.ok(!texts(doc).includes("Budget vs period spend"));
  assert.equal(doc.content.filter((c) => c.table).length, 1);
});

test("PDF, one project: cost variance to date is a sentence, not a table", () => {
  const doc = buildReportDocDefinition(make([project(1)]), options);
  assert.ok(texts(doc).includes("Cost variance (spend to date minus budget)"));
  const sentence = doc.content.find((c) => Array.isArray(c.text) && c.text.some((part) => String(part.text || part).includes("under budget")));
  assert.ok(sentence, "a sentence says the project is under budget");
  assert.equal(sentence.text[0].text, "-PHP 700.00");
});

test("PDF, several projects: Total row and BIR table stay, with the to-date columns", () => {
  const doc = buildReportDocDefinition(make([project(1), project(2)]), options);
  const body = mainTable(doc);
  assert.equal(body.length, 4); // header + 2 projects + total
  assert.deepEqual(body[0].map((c) => c.text), ["Project", "Budget", "Spend (period)", "Spend to date", "Budget left", "Used to date", "Status"]);
  assert.equal(doc.content.filter((c) => c.table).length, 3); // main, cost variance, BIR
});

test("PDF, several projects: the cost variance table has each project and a total, over budget in words", () => {
  const doc = buildReportDocDefinition(make([project(1), project(2, { varianceToDate: 250, varianceToDatePct: 25, cumulativeSpend: 1250, overrun: true })]), options);
  const varianceTable = doc.content.find((c) => c.table && c.table.body[0][0].text === "Project" && c.table.body[0].some((h) => h.text === "Cost variance")).table.body;
  assert.deepEqual(varianceTable[0].map((c) => c.text), ["Project", "Budget", "Spend to date", "Cost variance", "% of budget"]);
  assert.equal(varianceTable.length, 4); // header + 2 projects + total
  assert.equal(varianceTable[1][3].text, "-PHP 700.00");
  assert.equal(varianceTable[1][4].text, "-70.00%");
  assert.equal(varianceTable[2][3].text, "PHP 250.00");
  assert.equal(varianceTable[2][4].text, "25.00%");
  assert.equal(varianceTable[3][3].text, "-PHP 1,400.00");
});

test("PDF: Used to date comes from the cumulative percentage", () => {
  const doc = buildReportDocDefinition(make([project(1, { utilizationPct: 10, cumulativeUtilizationPct: 30 })]), options);
  assert.equal(mainTable(doc)[1][5].text, "30.00%");
});
