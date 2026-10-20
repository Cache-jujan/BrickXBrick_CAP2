// Site Manager home (app/site-manager.tsx): deadlines, the 7-day archive of
// completed tasks, and the per-project summary. Pure, so it is tested in Node.
//
// Dates: the server sends DATE columns either as "YYYY-MM-DD" or as an ISO
// timestamp at midnight in the server's time zone. Both are read as a calendar
// day in the phone's local time, the same day the rest of the app shows.

export const ARCHIVE_AFTER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A calendar day (local midnight) as a Date, or null when unreadable. */
export function toDay(value) {
  if (!value) return null;
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const d = plain ? new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3])) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole days from today to that day: 0 today, 1 tomorrow, -2 two days late. */
export function daysUntil(value, now = new Date()) {
  const day = toDay(value);
  if (!day) return null;
  const today = toDay(now);
  return Math.round((day.getTime() - today.getTime()) / DAY_MS);
}

/**
 * "Due today", "Due tomorrow", "Due in 5 days", "Overdue by 2 days".
 * @returns {{ text: string, tone: "late" | "today" | "soon" | "normal" }}
 */
export function dueLabel(value, now = new Date()) {
  const days = daysUntil(value, now);
  if (days === null) return { text: "No due date", tone: "normal" };
  if (days < 0) return { text: `Overdue by ${-days} day${days === -1 ? "" : "s"}`, tone: "late" };
  if (days === 0) return { text: "Due today", tone: "today" };
  if (days === 1) return { text: "Due tomorrow", tone: "soon" };
  return { text: `Due in ${days} days`, tone: days <= 3 ? "soon" : "normal" };
}

function completedOn(task) {
  return task.completedat || task.lastupdatedat || null;
}

/**
 * open:     not completed, nearest due date first (overdue on top)
 * recent:   completed in the last 7 days, newest first
 * archived: completed more than 7 days ago, newest first
 */
export function splitTasks(tasks, now = new Date()) {
  const list = Array.isArray(tasks) ? tasks : [];
  const byDue = (a, b) => (toDay(a.duedate)?.getTime() ?? Infinity) - (toDay(b.duedate)?.getTime() ?? Infinity);
  const byDone = (a, b) => (Date.parse(completedOn(b)) || 0) - (Date.parse(completedOn(a)) || 0);
  const open = list.filter((t) => t.status !== "Completed").sort(byDue);
  const recent = [];
  const archived = [];
  for (const t of list.filter((x) => x.status === "Completed")) {
    const done = Date.parse(completedOn(t));
    const old = Number.isFinite(done) && now.getTime() - done > ARCHIVE_AFTER_DAYS * DAY_MS;
    (old ? archived : recent).push(t);
  }
  return { open, recent: recent.sort(byDone), archived: archived.sort(byDone) };
}

/**
 * One row per project the Site Manager has tasks on: its dates, how many of
 * their tasks are still open, and the nearest open deadline (task or
 * milestone). Projects with the nearest deadline come first.
 */
export function projectSummaries(tasks, now = new Date()) {
  const byProject = new Map();
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const id = t.projectid || t.projectname;
    if (!id) continue;
    if (!byProject.has(id)) {
      byProject.set(id, {
        projectId: id,
        name: t.projectname || "Project",
        startDate: t.projectstartdate || null,
        endDate: t.projectenddate || null,
        openCount: 0,
        next: null,
      });
    }
    const p = byProject.get(id);
    if (t.status === "Completed") continue;
    p.openCount += 1;
    const candidates = [
      { label: t.taskname, date: t.duedate },
      { label: `${t.milestonename || "Milestone"} (milestone)`, date: t.milestoneduedate },
    ];
    for (const c of candidates) {
      const days = daysUntil(c.date, now);
      if (days === null) continue;
      if (!p.next || days < p.next.days) p.next = { label: c.label, date: c.date, days };
    }
  }
  return [...byProject.values()].sort((a, b) => (a.next?.days ?? Infinity) - (b.next?.days ?? Infinity));
}
