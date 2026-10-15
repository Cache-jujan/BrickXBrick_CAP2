// F2 — budget-justification BOM (adviser item 6): cost categories for every
// section, non-material costs, and an escalation allowance on top of the price
// agreed with the client. Synthetic figures only.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  COST_CATEGORIES,
  bomTotals,
  budgetWithEscalation,
  validateEscalation,
  validateBomPayload,
  guessCostCategory,
  buildBomWarnings,
  categoryOf,
} = require("../src/lib/bomRules");

const materials = (name, qty, cost, extra = {}) => ({
  name,
  laborRate: 0.5,
  items: [{ description: "Portland cement 40kg", quantity: qty, unit: "bags", unitCost: cost }],
  ...extra,
});
const fixed = (name, amount, costCategory) => ({ name, laborAmount: amount, items: [], costCategory });

test("a section without a category counts as Materials & Labor", () => {
  assert.equal(categoryOf({}), "Materials & Labor");
  assert.equal(categoryOf({ costCategory: "Not a category" }), "Materials & Labor");
  const out = validateBomPayload({ sections: [{ name: "STRUCTURAL", items: [] }] });
  assert.equal(out[0].costCategory, "Materials & Labor");
});

test("an unknown category is refused when saving", () => {
  assert.throws(
    () => validateBomPayload({ sections: [{ name: "Fees", costCategory: "Snacks", items: [] }] }),
    (err) => err.status === 400 && err.details.errors[0].field === "sections[0].costCategory"
  );
});

test("the BOM total is split by category and the parts add up to the total", () => {
  const sections = [
    materials("STRUCTURAL", 100, 300), // 30,000 + 50% labor = 45,000
    materials("MASONRY", 50, 200), // 10,000 + 5,000 = 15,000
    fixed("Mixer rental", 8000, "Equipment"),
    fixed("Structural engineer's fee", 45000, "Professional Fees"),
    fixed("Building permit", 12000, "Permits & Documentation"),
    fixed("Daily workers", 20000, "Manpower"),
  ];
  const t = bomTotals(sections);
  assert.equal(t.total, 145000);
  assert.deepEqual(Object.keys(t.byCategory), COST_CATEGORIES, "every category, in order");
  assert.equal(t.byCategory["Materials & Labor"], 60000);
  assert.equal(t.byCategory["Professional Fees"], 45000);
  assert.equal(t.byCategory.Utilities, 0);
  const sum = Object.values(t.byCategory).reduce((a, b) => a + b, 0);
  assert.equal(sum, t.total);
});

test("Target Budget = agreed price + allowance; the agreed price itself doesn't change", () => {
  assert.deepEqual(budgetWithEscalation(1450000, 0.05), {
    contractPrice: 1450000,
    escalationRate: 0.05,
    escalationAllowance: 72500,
    targetBudget: 1522500,
  });
  assert.equal(budgetWithEscalation(1000000, 0.055).escalationAllowance, 55000);
  assert.equal(budgetWithEscalation(100.1, 0.05).escalationAllowance, 5.01, "rounded to centavos");
  assert.equal(budgetWithEscalation(1000, 0).targetBudget, 1000);
});

test("the allowance must be 0% to 10%", () => {
  assert.equal(validateEscalation({ escalationRate: 0.055 }).escalationRate, 0.055);
  assert.equal(validateEscalation({ escalationRate: 0 }).escalationRate, 0);
  for (const bad of [0.15, -0.01, "five"]) {
    assert.throws(() => validateEscalation({ escalationRate: bad }), (e) => e.status === 400, String(bad));
  }
  assert.equal(validateEscalation({ sections: [] }), undefined, "not sent = leave as is");
  assert.equal(validateEscalation({ escalationNote: "   " }).escalationNote, null);
});

test("next-year construction with no allowance is flagged for the GM to confirm", () => {
  const sections = [materials("STRUCTURAL", 10, 100)];
  const w = buildBomWarnings(sections, { escalationRate: 0, constructionStartDate: "2027-01-11", today: "2026-10-16" });
  assert.ok(w.some((x) => x.code === "NO_ESCALATION" && x.level === "warning"));
  const ok = buildBomWarnings(sections, { escalationRate: 0.05, constructionStartDate: "2027-01-11", today: "2026-10-16" });
  assert.ok(!ok.some((x) => x.code === "NO_ESCALATION"));
  const sameYear = buildBomWarnings(sections, { escalationRate: 0, constructionStartDate: "2026-11-02", today: "2026-10-16" });
  assert.ok(!sameYear.some((x) => x.code === "NO_ESCALATION"));
});

test("no contingency and no allowance gives an info note, not a warning", () => {
  const w = buildBomWarnings([materials("STRUCTURAL", 10, 100)], {
    escalationRate: 0,
    constructionStartDate: "2026-11-02",
    today: "2026-10-16",
  });
  const note = w.find((x) => x.code === "NO_CONTINGENCY");
  assert.equal(note.level, "info");
  const withOverhead = buildBomWarnings([materials("STRUCTURAL", 10, 100), fixed("Supervision", 5000, "Overhead & Contingency")], {
    escalationRate: 0,
    constructionStartDate: "2026-11-02",
    today: "2026-10-16",
  });
  assert.ok(!withOverhead.some((x) => x.code === "NO_CONTINGENCY"));
});

test("old callers without escalation details get no new warnings", () => {
  const w = buildBomWarnings([materials("STRUCTURAL", 10, 100)], { statedTotal: null });
  assert.ok(!w.some((x) => x.code === "NO_ESCALATION" || x.code === "NO_CONTINGENCY"));
});

test("imported lump-sum lines get a category guessed from their name", () => {
  assert.equal(guessCostCategory({ name: "SUPERVISION & OVERHEAD", items: [] }), "Overhead & Contingency");
  assert.equal(guessCostCategory({ name: "BUILDING PERMIT AND CLEARANCES", items: [] }), "Permits & Documentation");
  assert.equal(guessCostCategory({ name: "ARCHITECTURAL & STRUCTURAL DESIGN", items: [] }), "Professional Fees");
  assert.equal(guessCostCategory({ name: "MOBILIZATION / DEMOBILIZATION", items: [] }), "Travel & Transport");
  assert.equal(guessCostCategory({ name: "TEMPORARY WATER AND ELECTRICITY", items: [] }), "Utilities");
  assert.equal(guessCostCategory({ name: "SCAFFOLDING RENTAL", items: [] }), "Equipment");
  assert.equal(guessCostCategory({ name: "DEMOLITION WORKS", items: [] }), "Materials & Labor", "no keyword: default");
  assert.equal(
    guessCostCategory({ name: "ELECTRICAL", items: [{ description: "wire" }] }),
    "Materials & Labor",
    "sections with materials are never guessed"
  );
});

test("approving sets the project budget to the Target Budget, not the bare BOM total (static check)", () => {
  const src = require("node:fs").readFileSync(require.resolve("../src/routes/bom.js"), "utf8");
  assert.match(src, /const budget = budgetBreakdown\(bom, sections\)\.targetBudget;/);
  assert.match(src, /costcategory = \$8/);
});
