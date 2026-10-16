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

// ---- project dates -------------------------------------------------------------
// The projects list returns DATE columns as ISO timestamps. Read the local
// calendar day, the same way the Projects pages do.
export function projectDay(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// { start, end } as YYYY-MM-DD or null. end = the day it really finished, else
// the target completion date (null when the project has neither).
export function projectSpan(project) {
  return {
    start: projectDay(project.startdate),
    end: projectDay(project.actualcompletiondate) || projectDay(project.enddate),
  };
}

const addDays = (day, n) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// The date range that covers every given project: earliest start to latest end.
// A project with no end date counts as running until `today` (or its start, if
// that is later). The range is cut to MAX_RANGE_DAYS from its start; `trimmed`
// says when that happened so the screen can tell the user.
export function spanOfProjects(projects, today = defaultReportRange().to) {
  const spans = projects.map(projectSpan).filter((s) => s.start);
  if (spans.length === 0) return null;
  const from = spans.map((s) => s.start).sort()[0];
  const to = spans.map((s) => s.end || (today > s.start ? today : s.start)).sort().at(-1);
  const limit = addDays(from, MAX_RANGE_DAYS - 1);
  return to > limit ? { from, to: limit, trimmed: true } : { from, to: to < from ? from : to, trimmed: false };
}

const NICE = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric" });
export function niceDay(day) {
  if (!day) return "";
  const [y, m, d] = day.split("-").map(Number);
  return NICE.format(new Date(y, m - 1, d));
}

// Plain-language reasons a report came back empty, so the GM is never left with
// a bare "nothing found". `selected` are the chosen projects (from the list).
export function explainEmpty({ selected, from, to, pendingExpenses }) {
  const reasons = [];
  if (from === to) reasons.push(`You chose a single day (${niceDay(from)}). Try a wider range.`);
  for (const project of selected) {
    const { start, end } = projectSpan(project);
    if (project.status === "Draft") {
      reasons.push(`${project.name} is still a Draft, and expenses are only recorded once a project is Active.`);
    } else if (start && to < start) {
      reasons.push(`${project.name} starts on ${niceDay(start)}, which is after your end date (${niceDay(to)}).`);
    } else if (end && from > end) {
      reasons.push(`${project.name} finished on ${niceDay(end)}, which is before your start date (${niceDay(from)}).`);
    }
  }
  if (pendingExpenses > 0) {
    reasons.push(
      `${pendingExpenses} ${pendingExpenses === 1 ? "expense is" : "expenses are"} still waiting for approval in this period. They will count once a manager approves them.`
    );
  }
  if (reasons.length === 0) {
    reasons.push(
      "No approved expense has a receipt date inside this range. Expenses are placed by the date printed on the receipt, not the date they were entered."
    );
  }
  return reasons;
}
