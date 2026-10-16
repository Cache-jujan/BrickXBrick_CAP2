// Quick checks for the Reports filters so the GM gets a message before a round
// trip. They mirror the server (backend/src/lib/reportFilters.js), which is the
// real enforcement point and answers 400 with the same rules.

export const MAX_PROJECTS = 5;
export const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) ? time : null;
}

// Returns { projectIds?, from?, to? } with a message per bad field; {} when fine.
export function validateReportFilters({ projectIds, from, to }) {
  const errors = {};
  if (projectIds.length === 0) errors.projectIds = "Select at least one project.";
  else if (projectIds.length > MAX_PROJECTS) errors.projectIds = `Select at most ${MAX_PROJECTS} projects.`;

  const fromTime = parseDay(from);
  const toTime = parseDay(to);
  if (fromTime === null) errors.from = "Pick a start date.";
  if (toTime === null) errors.to = "Pick an end date.";
  if (fromTime !== null && toTime !== null) {
    if (fromTime > toTime) errors.from = "The start date must be on or before the end date.";
    else if ((toTime - fromTime) / DAY_MS + 1 > MAX_RANGE_DAYS) {
      errors.to = `The date range can be at most ${MAX_RANGE_DAYS} days.`;
    }
  }
  return errors;
}

// Today and the first of this month, as the GM's local calendar dates.
export function defaultReportRange(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
}
