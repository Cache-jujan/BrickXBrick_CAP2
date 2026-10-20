// F2 — the project list is limited by role (adviser audit S12).
const test = require("node:test");
const assert = require("node:assert/strict");
const { projectListScope, hideBudgetFrom } = require("../src/lib/projectRules");

test("a Project Manager only lists projects they manage", () => {
  assert.deepEqual(projectListScope({ role: "Project Manager", id: "pm1" }), { column: "projectManagerId", value: "pm1" });
});

test("a Site Manager only lists their assigned project", () => {
  assert.deepEqual(projectListScope({ role: "Site Manager", id: "sm1" }), { column: "siteManagerId", value: "sm1" });
});

test("the General Manager and Purchaser list every project", () => {
  assert.equal(projectListScope({ role: "General Manager", id: "gm" }), null);
  assert.equal(projectListScope({ role: "Purchaser", id: "pu" }), null);
});

test("the Purchaser does not receive project budgets; others do", () => {
  const rows = [{ name: "A", budget: "100.00" }];
  assert.equal(hideBudgetFrom({ role: "Purchaser" }, rows)[0].budget, null);
  assert.equal(hideBudgetFrom({ role: "Project Manager" }, rows)[0].budget, "100.00");
  assert.equal(rows[0].budget, "100.00", "input not mutated");
});
