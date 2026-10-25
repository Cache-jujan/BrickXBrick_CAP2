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

export function asDate(value) {
  const raw = String(value ?? "").slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  if (year < MIN_TIMELINE_YEAR || year > MAX_TIMELINE_YEAR) return null;
  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== year || date.getMonth() + 1 !== Number(match[2]) || date.getDate() !== Number(match[3])) return null;
  return date;
}

export function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.Pending;
}

export function dueOf(item) {
  return asDate(item.duedate || item.dueDate);
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
  const due = new Date(task.duedate);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return due < today;
}
