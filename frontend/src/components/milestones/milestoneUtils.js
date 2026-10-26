const MIN_TIMELINE_YEAR = 2000;
const MAX_TIMELINE_YEAR = 2100;

// The label shown for each status comes from the catalog (status.*); only the CSS class lives here.
export const STATUS_META = {
  "On Track": { className: "on-track" },
  "At Risk": { className: "at-risk" },
  Overdue: { className: "overdue" },
  Pending: { className: "pending" },
  Completed: { className: "completed" },
};

// A real calendar day written as YYYY-MM-DD (or an ISO timestamp, whose first ten characters are the day).
function parseCalendarDate(value) {
  const raw = String(value ?? "").slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== year || date.getMonth() + 1 !== Number(match[2]) || date.getDate() !== Number(match[3])) return null;
  return date;
}

// The timeline additionally ignores years outside its range, so a typo can't stretch the chart.
export function asDate(value) {
  const date = parseCalendarDate(value);
  if (!date) return null;
  const year = date.getFullYear();
  if (year < MIN_TIMELINE_YEAR || year > MAX_TIMELINE_YEAR) return null;
  return date;
}

export function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.Pending;
}

export function dueOf(item) {
  return asDate(item.duedate || item.dueDate);
}

// For showing a due date as text. Unlike the chart it applies no year range, and a
// missing or invalid date reads as a dash rather than quietly turning into today.
export function formatDue(item, formatDate, options) {
  const date = parseCalendarDate(item.duedate || item.dueDate);
  return date ? formatDate(date, options) : "\u2014";
}

export function assigneeLabel(task, t) {
  if (task.handledby) return t("ms.handled_by", { who: task.handledby });
  if (task.assignedtoname) return task.assignedtoname;
  return t("tl.unassigned");
}

export function byDueDate(a, b) {
  const da = dueOf(a);
  const db = dueOf(b);
  return (da ? da.getTime() : Infinity) - (db ? db.getTime() : Infinity);
}

// A task is overdue when its due date has passed and it isn't Completed yet.
// Task status is only ever Pending or Completed, so "overdue"
// is derived here from the date rather than being a status the backend sends.
// Compared at day granularity: a task due today is not overdue.
export function taskIsOverdue(task) {
  if (task.status === "Completed") return false;
  const due = dueOf(task); // the local calendar day; new Date("2026-10-26") is UTC and reads a day early west of UTC
  if (!due) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}
