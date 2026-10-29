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
// `t` is the translate function from useLocale().
export function validateReportFilters({ projectIds, from, to }, t) {
  const errors = {};
  if (projectIds.length === 0) errors.projectIds = t("rep.err_select_one");
  else if (projectIds.length > MAX_PROJECTS) errors.projectIds = t("rep.err_select_max", { max: MAX_PROJECTS });

  const fromTime = parseDay(from);
  const toTime = parseDay(to);
  if (fromTime === null) errors.from = t("rep.err_start");
  if (toTime === null) errors.to = t("rep.err_end");
  if (fromTime !== null && toTime !== null) {
    if (fromTime > toTime) errors.from = t("rep.err_order");
    else if ((toTime - fromTime) / DAY_MS + 1 > MAX_RANGE_DAYS) {
      errors.to = t("rep.err_range", { max: MAX_RANGE_DAYS });
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

// One-click periods for the Reports screen, as the GM's local calendar dates.
// "Last 3 months" runs from the first of the month two months ago to today.
// `labelKey` is a catalog key; the caller translates it.
export function quickRanges(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const y = now.getFullYear();
  const m = now.getMonth();
  return [
    { labelKey: "rep.range_this_month", from: iso(new Date(y, m, 1)), to: iso(now) },
    { labelKey: "rep.range_last_month", from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) },
    { labelKey: "rep.range_last_3", from: iso(new Date(y, m - 2, 1)), to: iso(now) },
    { labelKey: "rep.range_this_year", from: iso(new Date(y, 0, 1)), to: iso(now) },
  ];
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
  // Four-digit year, so a year such as 0009 stays "0009" and still parses as a date.
  return `${String(d.getFullYear()).padStart(4, "0")}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Project dates outside these years are typing mistakes (for example 0009 for
// 2009). They are shown as saved but never used to work out a report range.
const MIN_PLAUSIBLE_YEAR = 2000;
const MAX_PLAUSIBLE_YEAR = 2100;
function plausibleDay(day) {
  if (!day) return null;
  const year = Number(String(day).slice(0, 4));
  return year >= MIN_PLAUSIBLE_YEAR && year <= MAX_PLAUSIBLE_YEAR ? day : null;
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
  const spans = projects
    .map(projectSpan)
    .map((s) => ({ start: plausibleDay(s.start), end: plausibleDay(s.end) }))
    .filter((s) => s.start);
  if (spans.length === 0) return null;
  const from = spans.map((s) => s.start).sort()[0];
  const to = spans.map((s) => s.end || (today > s.start ? today : s.start)).sort().at(-1);
  const limit = addDays(from, MAX_RANGE_DAYS - 1);
  return to > limit ? { from, to: limit, trimmed: true } : { from, to: to < from ? from : to, trimmed: false };
}

const NICE = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric" });
// `formatDate` (from useLocale) makes the month names follow the language; without it, English.
export function niceDay(day, formatDate) {
  if (!day) return "";
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(2000, m - 1, d);
  date.setFullYear(y); // new Date(y, ...) turns years 0-99 into 1900-1999
  return formatDate ? formatDate(date) : NICE.format(date);
}

// Plain-language reasons a report came back empty, so the GM is never left with
// a bare "nothing found". `selected` are the chosen projects (from the list).
export function explainEmpty({ selected, from, to, pendingExpenses, t, formatDate }) {
  const reasons = [];
  const day = (value) => niceDay(value, formatDate);
  if (from === to) reasons.push(t("rep.empty_single_day", { day: day(from) }));
  for (const project of selected) {
    const { start, end } = projectSpan(project);
    if (project.status === "Draft") {
      reasons.push(t("rep.empty_draft", { name: project.name }));
    } else if (start && to < start) {
      reasons.push(t("rep.empty_starts_after", { name: project.name, start: day(start), to: day(to) }));
    } else if (end && from > end) {
      reasons.push(t("rep.empty_finished_before", { name: project.name, end: day(end), from: day(from) }));
    }
  }
  if (pendingExpenses > 0) {
    reasons.push(pendingExpenses === 1 ? t("rep.empty_pending_one") : t("rep.empty_pending_other", { count: pendingExpenses }));
  }
  if (reasons.length === 0) {
    reasons.push(t("rep.empty_default"));
  }
  return reasons;
}
