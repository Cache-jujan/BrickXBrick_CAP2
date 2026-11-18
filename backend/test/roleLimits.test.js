// Unit tests for the account limits (lib/roleLimits.js): how many active accounts a role may have.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ROLE_LIMIT_DEFAULTS, loadRoleLimits, loadRoleUsage, validateRoleLimits, saveRoleLimits, roleFull, settingKey,
} = require("../src/lib/roleLimits");

// A tiny fake database: system_settings rows and Users rows.
function fakeDb({ settings = {}, users = [] } = {}) {
  const saved = [];
  async function run(sql, params = []) {
    const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
    if (text.includes("from system_settings")) {
      return { rows: Object.entries(settings).map(([key, value]) => ({ key, value })) };
    }
    if (text.startsWith("select count(*)::int as n from users")) {
      const [role, exclude] = params;
      const n = users.filter((u) => u.role === role && u.status === "Active" && u.userid !== exclude).length;
      return { rows: [{ n }] };
    }
    if (text.startsWith("select role, count(*)::int as n from users")) {
      const by = {};
      for (const u of users) if (u.status === "Active") by[u.role] = (by[u.role] || 0) + 1;
      return { rows: Object.entries(by).map(([role, n]) => ({ role, n })) };
    }
    if (text.startsWith("insert into system_settings")) {
      saved.push({ key: params[0], value: params[1] });
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${text}`);
  }
  run.saved = saved;
  return run;
}

const active = (role, userid) => ({ role, userid, status: "Active" });

test("defaults are the numbers agreed with the adviser: 2, 2, 2, 2 and 3 for Site Manager", async () => {
  assert.deepEqual(await loadRoleLimits(fakeDb()), {
    "System Administrator": 2, "General Manager": 2, "Project Manager": 2, "Purchaser": 2, "Site Manager": 3,
  });
  assert.deepEqual(ROLE_LIMIT_DEFAULTS["Site Manager"], 3);
});

test("a saved limit overrides the default; bad stored values fall back to it", async () => {
  const limits = await loadRoleLimits(fakeDb({
    settings: { [settingKey("Project Manager")]: "5", [settingKey("Purchaser")]: "zero", [settingKey("Site Manager")]: "0" },
  }));
  assert.equal(limits["Project Manager"], 5);
  assert.equal(limits["Purchaser"], 2);
  assert.equal(limits["Site Manager"], 3);
});

test("a role with room is not full; at the limit it is, and the message names the role and the limit", async () => {
  const db = fakeDb({ users: [active("Project Manager", "a")] });
  assert.equal(await roleFull(db, "Project Manager"), null);
  const db2 = fakeDb({ users: [active("Project Manager", "a"), active("Project Manager", "b")] });
  const full = await roleFull(db2, "Project Manager");
  assert.equal(full.code, "role_limit_reached");
  assert.equal(full.limit, 2);
  assert.equal(full.active, 2);
  assert.match(full.error, /2 active Project Manager accounts, which is the limit \(2\)/);
});

test("inactive accounts do not count, and the person being moved never counts against themselves", async () => {
  const users = [
    active("Project Manager", "a"),
    { role: "Project Manager", userid: "b", status: "Inactive" },
  ];
  assert.equal(await roleFull(fakeDb({ users }), "Project Manager"), null);
  const two = [active("Project Manager", "a"), active("Project Manager", "b")];
  assert.equal(await roleFull(fakeDb({ users: two }), "Project Manager", "b"), null);
});

test("raising the limit makes room again; lowering it below today's count only blocks new accounts", async () => {
  const users = [active("Purchaser", "a"), active("Purchaser", "b")];
  assert.ok(await roleFull(fakeDb({ users }), "Purchaser"));
  assert.equal(await roleFull(fakeDb({ users, settings: { [settingKey("Purchaser")]: "3" } }), "Purchaser"), null);
  const usage = await loadRoleUsage(fakeDb({ users, settings: { [settingKey("Purchaser")]: "1" } }));
  const row = usage.roles.find((r) => r.role === "Purchaser");
  assert.deepEqual({ active: row.active, limit: row.limit, full: row.full, over: row.over }, { active: 2, limit: 1, full: true, over: true });
});

test("usage lists every role in a fixed order with its count", async () => {
  const usage = await loadRoleUsage(fakeDb({ users: [active("Site Manager", "a"), active("Site Manager", "b")] }));
  assert.deepEqual(usage.roles.map((r) => r.role), [
    "System Administrator", "General Manager", "Project Manager", "Purchaser", "Site Manager",
  ]);
  const sm = usage.roles.find((r) => r.role === "Site Manager");
  assert.deepEqual({ active: sm.active, limit: sm.limit, full: sm.full }, { active: 2, limit: 3, full: false });
});

test("validate: whole numbers from 1 to 50 for known roles only", () => {
  assert.deepEqual(validateRoleLimits({ limits: { "Project Manager": 4, "Site Manager": 10 } }), { "Project Manager": 4, "Site Manager": 10 });
  for (const bad of [{}, { limits: {} }, { limits: { "Project Manager": 0 } }, { limits: { "Project Manager": 51 } },
    { limits: { "Project Manager": 2.5 } }, { limits: { "Project Manager": "3" } }, { limits: { Janitor: 2 } }, null]) {
    assert.throws(() => validateRoleLimits(bad), (err) => err.status === 400 && Array.isArray(err.fieldErrors));
  }
});

test("save writes one settings row per role and keeps the others untouched", async () => {
  const db = fakeDb();
  await saveRoleLimits(db, { "Project Manager": 4 });
  assert.deepEqual(db.saved, [{ key: "max_accounts_project_manager", value: "4" }]);
});
