// projectDateLock.js — the target date of development and the target date of
// construction are locked once a project leaves Draft (Nov 2026 refinement).
//
// While a project is in Draft the GM can still move them freely: planning,
// permits and procurement are still being arranged. After activation the
// schedule everybody committed to is fixed, so neither date can change, for
// anyone, the General Manager included. The target date of completion is NOT
// locked: it is the one date that can still move once work has started.
//
// Completed / Cancelled / Archived projects never reach this check — the edit
// route already refuses them with its own 409.

const { httpError } = require("./projectRules");

// [body/field name, label used in the error message]
const LOCKED_DATE_FIELDS = [
  ["startDate", "Target date of development"],
  ["constructionStartDate", "Target date of construction"],
];

// node-postgres returns a DATE as a JS Date at *local* midnight of the server,
// so read the local calendar fields (toISOString() would shift a day on a
// UTC+8 server). Strings are already YYYY-MM-DD, or an ISO timestamp.
function dayOf(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function datesAreLocked(status) {
  return status !== "Draft";
}

// existing: the stored projects row (Postgres lowercases column names).
// fields:   the validated, merged values about to be saved (ISO date strings).
// Returns the list of locked fields the edit tries to change (empty = fine).
function lockedDateChanges(existing, fields) {
  if (!existing || !datesAreLocked(existing.status)) return [];
  const stored = {
    startDate: dayOf(existing.startdate),
    constructionStartDate: dayOf(existing.constructionstartdate),
  };
  return LOCKED_DATE_FIELDS.filter(([field]) => dayOf(fields[field]) !== stored[field]).map(([field, label]) => ({
    field,
    message: `${label} is locked once the project is active and can't be changed`,
  }));
}

// Throws a 409 naming every locked date the edit tried to change.
function assertDatesUnlocked(existing, fields) {
  const changes = lockedDateChanges(existing, fields);
  if (changes.length === 0) return;
  throw httpError(409, changes.map((c) => c.message).join("; "), { fieldErrors: changes });
}

module.exports = { LOCKED_DATE_FIELDS, datesAreLocked, lockedDateChanges, assertDatesUnlocked };
