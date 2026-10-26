// F1 admin overview (lib/adminOverview.js). A fake query stands in for Postgres.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAdminOverview } = require("../src/lib/adminOverview");

function fakeQuery(totals, roles) {
  const calls = [];
  const query = async (sql) => {
    calls.push(String(sql));
    if (/GROUP BY role/.test(sql)) return { rows: roles };
    return { rows: [totals] };
  };
  return { query, calls };
}

test("maps the counts and the roles", async () => {
  const db = fakeQuery(
    { active: 9, inactive: 2, locked: 1, open_alerts: 3, pending_chain: 4, overdue_chain: 2 },
    [{ role: "General Manager", count: 1 }, { role: "Project Manager", count: 3 }]
  );
  const out = await loadAdminOverview({ query: db.query });
  assert.deepEqual(out, {
    active: 9, inactive: 2, locked: 1, openTamperAlerts: 3,
    pendingBlockchain: 4, overdueBlockchain: 2,
    byRole: { "General Manager": 1, "Project Manager": 3 },
  });
});

test("an empty database gives zeros, not undefined", async () => {
  const out = await loadAdminOverview({ query: fakeQuery({}, []).query });
  assert.equal(out.active, 0);
  assert.equal(out.overdueBlockchain, 0);
  assert.deepEqual(out.byRole, {});
});

test("only active accounts are counted by role, and only unresolved alerts are open", async () => {
  const db = fakeQuery({}, []);
  await loadAdminOverview({ query: db.query });
  assert.match(db.calls[1], /WHERE status = 'Active' GROUP BY role/);
  assert.match(db.calls[0], /tamper_alerts WHERE resolvedAt IS NULL/);
  assert.match(db.calls[0], /INTERVAL '72 hours'/);
});
