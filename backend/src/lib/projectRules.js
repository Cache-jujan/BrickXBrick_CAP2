// projectRules.js — F2 project lifecycle and manager-assignment rules.
//
// Pure functions first (unit-tested in test/projectRules.test.js), then the
// helpers that need a database. Every DB helper takes `runQuery` (or a
// transaction client) so tests can pass a fake.
//
// Sources for each rule:
//   - Lifecycle dates, type, location: adviser consultation (Oct 2026), item 3
//   - One open project per PM, three per SM, Consolacion service area:
//     pilot client answers (Oct 2026); limits live in system_settings
//   - Pre-construction assignment: adviser item 2 — PM is required at
//     creation, SM is required before the project can be activated

const PROJECT_TYPES = [
  "Residential Building",
  "Commercial Building",
  "Fit-out / Renovation",
  "Civil Works",
  "Structural Retrofitting",
  "Drainage / Flood Control",
  "Road Maintenance",
  "Other",
];

// A project in either of these states occupies its PM and SM.
const OPEN_PROJECT_STATUSES = ["Draft", "Active"];

// Statuses whose details can no longer be edited or reassigned.
const CLOSED_PROJECT_STATUSES = ["Completed", "Cancelled", "Archived"];

const DEFAULT_SETTINGS = {
  pmMaxOpenProjects: 1,
  smMaxOpenProjects: 3,
  serviceAreaMunicipalities: ["consolacion"],
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function httpError(status, message, extra) {
  const err = new Error(message);
  err.status = status;
  if (extra) err.details = extra;
  return err;
}

function isIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Validates the three planned dates. Returns a list of { field, message };
 * an empty list means valid. ISO strings compare correctly as strings.
 *   startDate             target date of development (required)
 *   constructionStartDate target date of construction (required)
 *   endDate               target date of completion   (required)
 */
function validateProjectDates({ startDate, constructionStartDate, endDate }) {
  const errors = [];
  const fields = [
    ["startDate", startDate, "Target date of development"],
    ["constructionStartDate", constructionStartDate, "Target date of construction"],
    ["endDate", endDate, "Target date of completion"],
  ];
  for (const [field, value, label] of fields) {
    if (value === undefined || value === null || value === "") {
      errors.push({ field, message: `${label} is required` });
    } else if (!isIsoDate(value)) {
      errors.push({ field, message: `${label} must be a valid date (YYYY-MM-DD)` });
    }
  }
  if (errors.length) return errors;

  if (constructionStartDate < startDate) {
    errors.push({
      field: "constructionStartDate",
      message: "Target date of construction can't be before the target date of development",
    });
  }
  if (endDate < constructionStartDate) {
    errors.push({
      field: "endDate",
      message: "Target date of completion can't be before the target date of construction",
    });
  }
  return errors;
}

// "Mandaue", "Mandaue City", "City of Mandaue" and "Municipality of
// Consolacion" all compare equal, so the GM doesn't trip the warning just by
// typing the name differently.
function normalizeMunicipality(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(city|municipality) of /, "")
    .replace(/ (city|municipality)$/, "")
    .trim();
}

function parseServiceArea(settingValue) {
  return String(settingValue || "")
    .split(",")
    .map(normalizeMunicipality)
    .filter(Boolean);
}

function isWithinServiceArea(municipality, serviceArea) {
  const m = normalizeMunicipality(municipality);
  if (!m) return true; // nothing to warn about yet
  return serviceArea.includes(m);
}

/**
 * Non-blocking warnings shown to the GM. Today: a site outside the service
 * area (client: such projects are usually handed to a subcontractor).
 */
function buildProjectWarnings({ municipality }, settings) {
  const warnings = [];
  if (municipality && !isWithinServiceArea(municipality, settings.serviceAreaMunicipalities)) {
    warnings.push({
      code: "OUTSIDE_SERVICE_AREA",
      message: `${String(municipality).trim()} is outside the usual service area. Projects there are usually handled by a subcontractor.`,
    });
  }
  return warnings;
}

/**
 * Decides whether a manager can take one more project.
 * openProjects excludes the project being edited (the caller filters it).
 */
function evaluateAvailability(openProjects, maxOpenProjects) {
  const count = openProjects.length;
  return {
    openProjectCount: count,
    maxOpenProjects,
    available: count < maxOpenProjects,
  };
}

/**
 * Allowed status changes. Activation, cancellation and completion each have
 * their own route; this is the single source of truth for which moves are legal.
 */
const STATUS_TRANSITIONS = {
  Draft: ["Active", "Cancelled"],
  Active: ["Completed", "Cancelled"],
  Completed: ["Archived"],
  Cancelled: ["Archived"],
  Archived: [],
};

function assertStatusTransition(from, to) {
  const allowed = STATUS_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw httpError(409, `A ${from} project can't be changed to ${to}`);
  }
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

async function loadProjectSettings(runQuery) {
  const result = await runQuery(
    `SELECT settingKey AS "key", settingValue AS "value"
       FROM system_settings
      WHERE settingKey IN ('pm_max_open_projects', 'sm_max_open_projects', 'service_area_municipalities')`
  );
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of result.rows) {
    if (row.key === "pm_max_open_projects") {
      const n = Number.parseInt(row.value, 10);
      if (Number.isInteger(n) && n > 0) settings.pmMaxOpenProjects = n;
    } else if (row.key === "sm_max_open_projects") {
      const n = Number.parseInt(row.value, 10);
      if (Number.isInteger(n) && n > 0) settings.smMaxOpenProjects = n;
    } else if (row.key === "service_area_municipalities") {
      const list = parseServiceArea(row.value);
      if (list.length) settings.serviceAreaMunicipalities = list;
    }
  }
  return settings;
}

const ROLE_COLUMN = {
  "Project Manager": "projectManagerId",
  "Site Manager": "siteManagerId",
};

function maxForRole(role, settings) {
  return role === "Project Manager" ? settings.pmMaxOpenProjects : settings.smMaxOpenProjects;
}

/**
 * Every active manager of `role` with the open projects they hold. Used by
 * the GM's dropdowns so they can see who is free and what the busy ones are
 * working on (adviser item 2: availability filter + visible schedules).
 */
async function loadManagerWorkload(runQuery, role, { excludeProjectId = null, settings } = {}) {
  const column = ROLE_COLUMN[role];
  if (!column) throw new Error(`Unsupported manager role: ${role}`);

  const result = await runQuery(
    `SELECT u.userid, u.name, u.email,
            p.projectid, p.name AS projectname, p.status AS projectstatus,
            p.startdate, p.constructionstartdate, p.enddate, p.municipality
       FROM users u
       LEFT JOIN projects p
         ON p.${column} = u.userid
        AND p.status = ANY($2::text[])
        AND ($3::uuid IS NULL OR p.projectid <> $3::uuid)
      WHERE u.role = $1 AND u.status = 'Active'
      ORDER BY u.name ASC, p.startdate ASC`,
    [role, OPEN_PROJECT_STATUSES, excludeProjectId]
  );

  const max = maxForRole(role, settings || DEFAULT_SETTINGS);
  const byUser = new Map();
  for (const row of result.rows) {
    if (!byUser.has(row.userid)) {
      byUser.set(row.userid, { userid: row.userid, name: row.name, email: row.email, openProjects: [] });
    }
    if (row.projectid) {
      byUser.get(row.userid).openProjects.push({
        projectid: row.projectid,
        name: row.projectname,
        status: row.projectstatus,
        startdate: row.startdate,
        constructionstartdate: row.constructionstartdate,
        enddate: row.enddate,
        municipality: row.municipality,
      });
    }
  }
  return [...byUser.values()].map((m) => ({ ...m, ...evaluateAvailability(m.openProjects, max) }));
}

/**
 * Throws unless `userId` is an active user with `role` who can take one more
 * project. Locks the user row (FOR UPDATE) so two GMs assigning the same
 * manager at the same moment can't both get past the limit — call it with
 * the transaction client.
 */
async function assertManagerAvailable(client, { userId, role, excludeProjectId = null, settings }) {
  const label = role === "Project Manager" ? "Project Manager" : "Site Manager";
  const userResult = await client.query(
    "SELECT userid, name, role, status FROM users WHERE userid = $1 FOR UPDATE",
    [userId]
  );
  if (userResult.rowCount === 0) {
    throw httpError(400, `${label} does not match an existing user`);
  }
  const user = userResult.rows[0];
  if (user.role !== role) {
    throw httpError(400, `The selected user is not a ${label}`);
  }
  if (user.status !== "Active") {
    throw httpError(400, `The selected ${label} account is deactivated`);
  }

  const column = ROLE_COLUMN[role];
  const openResult = await client.query(
    `SELECT projectid, name
       FROM projects
      WHERE ${column} = $1
        AND status = ANY($2::text[])
        AND ($3::uuid IS NULL OR projectid <> $3::uuid)
      ORDER BY startdate ASC`,
    [userId, OPEN_PROJECT_STATUSES, excludeProjectId]
  );
  const max = maxForRole(role, settings);
  const { available } = evaluateAvailability(openResult.rows, max);
  if (!available) {
    const names = openResult.rows.map((r) => r.name).join(", ");
    throw httpError(
      409,
      `${user.name.trim()} already has ${openResult.rowCount} open project(s) (${names}); the limit for a ${label} is ${max}`,
      { openProjects: openResult.rows, maxOpenProjects: max }
    );
  }
  return user;
}

async function notifyProject(client, { recipientId, type, projectId, message }) {
  if (!recipientId) return;
  await client.query(
    `INSERT INTO notifications (recipientId, type, relatedEntityType, relatedEntityId, message)
     VALUES ($1, $2, 'Project', $3, $4)`,
    [recipientId, type, projectId, message]
  );
}

/**
 * Throws 409 unless the project exists and is Active. Purchases and tickets
 * are only allowed once the project has left Draft (client: the BOM is signed
 * before any purchase; activation requires the approved BOM).
 */
async function assertProjectActive(runQuery, projectId, action = "This action") {
  const result = await runQuery("SELECT status FROM projects WHERE projectid = $1", [projectId]);
  if (result.rowCount === 0) throw httpError(404, `Project ${projectId} not found`);
  const { status } = result.rows[0];
  if (status !== "Active") {
    throw httpError(409, `${action} requires an Active project; this project is ${status}`);
  }
}

module.exports = {
  PROJECT_TYPES,
  OPEN_PROJECT_STATUSES,
  CLOSED_PROJECT_STATUSES,
  DEFAULT_SETTINGS,
  STATUS_TRANSITIONS,
  httpError,
  isIsoDate,
  validateProjectDates,
  normalizeMunicipality,
  parseServiceArea,
  isWithinServiceArea,
  buildProjectWarnings,
  evaluateAvailability,
  assertStatusTransition,
  loadProjectSettings,
  loadManagerWorkload,
  assertManagerAvailable,
  notifyProject,
  assertProjectActive,
};
