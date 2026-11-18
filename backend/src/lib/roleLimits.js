// roleLimits.js: how many ACTIVE accounts each role may have (adviser item, Nov 2026).
//
// The System Administrator sets the numbers (the same idea as the General Manager's
// limit on open projects per PM and SM, so a different company can set its own).
// They live in system_settings, one row per role, and fall back to the defaults the
// team agreed with the adviser when no row exists. No migration is needed.
//
// What a limit does:  blocks a NEW active account in a full role: creating a user,
//                     changing someone into the role, or reactivating an inactive account.
// What it never does: remove, disable or change anyone who already exists. Lowering a
//                     limit below today's count only blocks new accounts until people leave.
// Inactive accounts don't count, so deactivating someone frees their place.

const ROLE_LIMIT_DEFAULTS = {
  "System Administrator": 2,
  "General Manager": 2,
  "Project Manager": 2,
  "Purchaser": 2,
  "Site Manager": 3,
};

const ROLES = Object.keys(ROLE_LIMIT_DEFAULTS);
const LIMIT_MIN = 1;
const LIMIT_MAX = 50;

const SETTING_PREFIX = "max_accounts_";
const SLUGS = {
  "System Administrator": "system_administrator",
  "General Manager": "general_manager",
  "Project Manager": "project_manager",
  "Purchaser": "purchaser",
  "Site Manager": "site_manager",
};

const settingKey = (role) => `${SETTING_PREFIX}${SLUGS[role]}`;

class LimitInputError extends Error {
  constructor(message, fieldErrors) {
    super(message);
    this.status = 400;
    this.fieldErrors = fieldErrors;
  }
}

// runQuery(sql, params) -> { rows }, so it works with the pool and with a transaction client.
async function loadRoleLimits(runQuery) {
  const limits = { ...ROLE_LIMIT_DEFAULTS };
  const result = await runQuery(
    `SELECT settingKey AS "key", settingValue AS "value"
       FROM system_settings
      WHERE settingKey LIKE 'max_accounts\\_%'`
  );
  for (const row of result.rows || []) {
    const role = ROLES.find((r) => settingKey(r) === row.key);
    const n = Number.parseInt(row.value, 10);
    if (role && Number.isInteger(n) && n >= LIMIT_MIN && n <= LIMIT_MAX) limits[role] = n;
  }
  return limits;
}

async function countActive(runQuery, role, excludeUserId = null) {
  const result = await runQuery(
    `SELECT COUNT(*)::int AS n FROM Users
      WHERE role = $1 AND status = 'Active' AND ($2::uuid IS NULL OR userID <> $2::uuid)`,
    [role, excludeUserId]
  );
  return Number(result.rows?.[0]?.n) || 0;
}

// One row per role for the Account limits card.
async function loadRoleUsage(runQuery) {
  const limits = await loadRoleLimits(runQuery);
  const counts = await runQuery(`SELECT role, COUNT(*)::int AS n FROM Users WHERE status = 'Active' GROUP BY role`);
  const byRole = Object.fromEntries((counts.rows || []).map((r) => [r.role, Number(r.n) || 0]));
  return {
    min: LIMIT_MIN,
    max: LIMIT_MAX,
    roles: ROLES.map((role) => {
      const active = byRole[role] || 0;
      const limit = limits[role];
      return { role, limit, active, full: active >= limit, over: active > limit };
    }),
  };
}

// Body { limits: { "Project Manager": 3, ... } }: whole numbers LIMIT_MIN to LIMIT_MAX, known roles only.
function validateRoleLimits(body) {
  const given = body && typeof body.limits === "object" && body.limits !== null ? body.limits : null;
  const entries = given ? Object.entries(given) : [];
  const errors = [];
  const out = {};
  if (entries.length === 0) errors.push({ field: "limits", message: "Send at least one role limit" });
  for (const [role, value] of entries) {
    if (!ROLES.includes(role)) {
      errors.push({ field: role, message: "Unknown role" });
    } else if (!Number.isInteger(value) || value < LIMIT_MIN || value > LIMIT_MAX) {
      errors.push({ field: role, message: `Must be a whole number from ${LIMIT_MIN} to ${LIMIT_MAX}` });
    } else {
      out[role] = value;
    }
  }
  if (errors.length) throw new LimitInputError(errors[0].message, errors);
  return out;
}

async function saveRoleLimits(runQuery, limits) {
  for (const [role, value] of Object.entries(limits)) {
    await runQuery(
      `INSERT INTO system_settings (settingKey, settingValue, description, updatedAt)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (settingKey) DO UPDATE SET settingValue = EXCLUDED.settingValue, updatedAt = NOW()`,
      [settingKey(role), String(value), `Max active ${role} accounts`]
    );
  }
}

// Returns the 409 body when the role has no room for one more active account, otherwise null.
// excludeUserId: the person being moved or reactivated, so they never count against themselves.
async function roleFull(runQuery, role, excludeUserId = null) {
  if (!ROLES.includes(role)) return null;
  const limits = await loadRoleLimits(runQuery);
  const limit = limits[role];
  const active = await countActive(runQuery, role, excludeUserId);
  if (active < limit) return null;
  return {
    error: `There ${active === 1 ? "is already 1 active" : `are already ${active} active`} ${role} ${active === 1 ? "account" : "accounts"}, which is the limit (${limit}). Raise the limit under Account limits, or deactivate one first.`,
    code: "role_limit_reached",
    role,
    limit,
    active,
  };
}

// Two requests for the same role at the same moment must not both find room.
// Call inside a transaction: the lock is released at commit or rollback.
async function lockRole(client, role) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`role-limit:${role}`]);
}

module.exports = {
  ROLE_LIMIT_DEFAULTS, ROLES, LIMIT_MIN, LIMIT_MAX, LimitInputError,
  settingKey, loadRoleLimits, loadRoleUsage, validateRoleLimits, saveRoleLimits, roleFull, lockRole, countActive,
};
