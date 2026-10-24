// The template catalog (infra/db/templates/project-templates.json) and the
// migration that seeds it (047) must agree, and the catalog must stay structure-only.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { PROJECT_TYPES } = require("../src/lib/projectRules");

const ROOT = path.resolve(__dirname, "../../infra/db");
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "templates/project-templates.json"), "utf8"));
const seed = fs.readFileSync(path.join(ROOT, "migrations/047_seed_project_templates.sql"), "utf8");
const STANDARD = catalog.requirementCatalog.standard.map((d) => d.code);
const FORBIDDEN_KEYS = /price|cost|quantity|qty|amount|unit|supplier|vendor|assignee|assignedTo|progress|photo|ticket|expense|receipt|note|bom(Item|Line)/i;

test("every template uses a real project type", () => {
  for (const t of catalog.templates) assert.ok(PROJECT_TYPES.includes(t.projectType), `${t.templateId}: ${t.projectType}`);
});

test("there are 12 standard documents, in every template exactly once, checked by default", () => {
  assert.equal(STANDARD.length, 12);
  for (const t of catalog.templates) {
    const tasks = t.milestones.flatMap((m) => m.tasks);
    for (const code of STANDARD) {
      const hits = tasks.filter((k) => k.requirementCode === code);
      assert.equal(hits.length, 1, `${t.templateId} ${code}`);
      assert.equal(hits[0].defaultIncluded, true);
    }
    for (const k of tasks.filter((x) => x.requirementCode?.startsWith("COND-"))) {
      assert.equal(k.defaultIncluded, false, `${t.templateId} ${k.requirementCode} must start unchecked`);
    }
  }
});

test("Planning tasks are owned by GM/PM; Construction tasks have no owner role", () => {
  for (const t of catalog.templates) {
    for (const m of t.milestones) {
      for (const k of m.tasks) {
        if (m.phase === "Planning") assert.ok(["GM", "PM"].includes(k.handledBy), `${t.templateId}/${k.name}`);
        else assert.equal(k.handledBy, undefined, `${t.templateId}/${k.name}`);
        assert.ok(k.name.length > 0 && k.name.length <= 150);
        assert.ok(k.dueOffsetDays >= 0 && k.dueOffsetDays <= m.dueOffsetDays, `${t.templateId}/${k.name}`);
      }
    }
  }
});

test("each template has Planning first, then Construction, and a permit submit/receive step", () => {
  for (const t of catalog.templates) {
    const phases = t.milestones.map((m) => m.phase);
    assert.equal(phases[0], "Planning");
    assert.ok(phases.includes("Construction"));
    assert.deepEqual(phases, [...phases].sort((a, b) => (a === b ? 0 : a === "Planning" ? -1 : 1)));
    const names = t.milestones.flatMap((m) => m.tasks.map((k) => k.name.toLowerCase())).join("|");
    assert.match(names, /submit/, t.templateId);
    assert.match(names, /receive approved permits/, t.templateId);
  }
});

test("templates stay structure-only (no BOM, prices, quantities, assignees, progress, notes)", () => {
  const walk = (value, trail) => {
    if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${trail}[${i}]`));
    if (value && typeof value === "object") {
      for (const [key, v] of Object.entries(value)) {
        if (!["tasks", "milestones"].includes(key)) {
          assert.ok(!FORBIDDEN_KEYS.test(key) || key === "hint", `${trail}.${key}`);
        }
        walk(v, `${trail}.${key}`);
      }
    }
  };
  for (const t of catalog.templates) walk(t, t.templateId);
});

test("the seed migration contains every template, milestone and task in the catalog", () => {
  for (const t of catalog.templates) {
    assert.ok(seed.includes(`'${t.templateId}'`), `seed is missing ${t.templateId}`);
    for (const m of t.milestones) {
      assert.ok(seed.includes(`'${m.name.replace(/'/g, "''")}'`), `seed is missing milestone ${m.name}`);
    }
  }
  const taskCount = catalog.templates.reduce((a, t) => a + t.milestones.reduce((b, m) => b + m.tasks.length, 0), 0);
  // Task rows start "  (<milestone sequence>, <task sequence>, '<name>'"; milestone rows have one number.
  const rows = seed.match(/^ {2}\(\d+, \d+, '/gm) || [];
  assert.equal(rows.length, taskCount, "seed task rows must match the catalog");
});
