import { asDate, byDueDate, dueOf } from "./milestoneUtils";

export const DAY_MS = 24 * 60 * 60 * 1000;

function startOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay();
  result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfWeek(date) {
  const result = new Date(date);
  result.setDate(result.getDate() + 6);
  result.setHours(23, 59, 59, 999);
  return result;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function explicitStartOf(item) {
  return asDate(item.startdate || item.startDate);
}

// Milestones and tasks only store a due date, not a start date. Without a start
// every bar falls back to the first column of the chart (the "everything starts
// at the left edge" bug). So we work out a start for each bar:
//   - an explicit start date wins if the item ever has one;
//   - a milestone starts where the previous milestone of its phase is due, or at
//     the project's phase start (Planning = project start, Construction =
//     construction start) for the first one;
//   - a task starts where the previous task is due, or at its milestone's start.
// A start can never be after its own due date.
export function buildSchedule(project, milestones) {
  const schedule = new Map();
  const projectStart = asDate(project?.startdate);
  const constructionStart = asDate(project?.constructionstartdate) || projectStart;

  ["Planning", "Construction"].forEach((phase) => {
    const inPhase = milestones
      .filter((m) => (phase === "Planning" ? m.phase === "Planning" : m.phase !== "Planning"))
      .sort(byDueDate);
    let cursor = phase === "Planning" ? projectStart : constructionStart;

    inPhase.forEach((milestone) => {
      const end = dueOf(milestone);
      let start = explicitStartOf(milestone) || cursor || end;
      if (end && start && start > end) start = end;
      schedule.set(milestone, { start, end });
      if (end) cursor = end;

      let taskCursor = start;
      [...(milestone.tasks || [])].sort(byDueDate).forEach((task) => {
        const taskEnd = dueOf(task);
        let taskStart = explicitStartOf(task) || taskCursor || taskEnd;
        if (taskEnd && taskStart && taskStart > taskEnd) taskStart = taskEnd;
        schedule.set(task, { start: taskStart, end: taskEnd });
        if (taskEnd) taskCursor = taskEnd;
      });
    });
  });

  return schedule;
}

// The first and last calendar day anything on the project touches.
export function getExtent(project, milestones) {
  const values = [project?.startdate, project?.enddate];
  milestones.forEach((milestone) => {
    values.push(milestone.startdate || milestone.startDate, milestone.duedate || milestone.dueDate);
    (milestone.tasks || []).forEach((task) => {
      values.push(task.startdate || task.startDate, task.duedate || task.dueDate);
    });
  });
  const dates = values.map(asDate).filter(Boolean);
  const first = [...dates].sort((a, b) => a - b)[0] || new Date();
  const last = [...dates].sort((a, b) => b - a)[0] || new Date(first.getTime() + 56 * DAY_MS);
  return { first, last };
}

// Weeks zoom: the range is rounded out to whole weeks.
export function getRange(project, milestones) {
  const { first, last } = getExtent(project, milestones);
  const start = startOfWeek(first);
  const end = endOfWeek(last);
  return { start, end, total: Math.max(DAY_MS, end - start) };
}

// Months zoom: the range is exactly the first to the last day, so the chart
// fills its width with no padding weeks on either side.
export function getMonthRange(project, milestones) {
  const { first, last } = getExtent(project, milestones);
  const start = new Date(first);
  start.setHours(0, 0, 0, 0);
  const lastDay = new Date(last);
  lastDay.setHours(0, 0, 0, 0);
  // Counted in calendar days, not milliseconds, so a daylight-saving change inside the range adds no phantom hour.
  const total = Math.max(1, Math.round((lastDay - start) / DAY_MS) + 1) * DAY_MS;
  return { start, end: new Date(start.getTime() + total - 1), total, lastDay };
}

// One cell per calendar month, as a share of the range. The first and last
// cells can be partial, so their share is smaller than a full month's.
export function getMonthCells(range) {
  const cells = [];
  const rangeEnd = range.start.getTime() + range.total;
  let monthStart = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
  while (monthStart.getTime() < rangeEnd) {
    const next = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
    const from = Math.max(monthStart.getTime(), range.start.getTime());
    const to = Math.min(next.getTime(), rangeEnd);
    cells.push({
      key: `${monthStart.getFullYear()}-${monthStart.getMonth()}`,
      date: monthStart,
      left: ((from - range.start) / range.total) * 100,
      width: ((to - from) / range.total) * 100,
    });
    monthStart = next;
  }
  return cells;
}

// One cell per week of a Weeks-zoom range.
export function getWeekCells(range) {
  const cells = [];
  const count = Math.max(1, Math.round(range.total / (7 * DAY_MS)));
  for (let i = 0; i < count; i += 1) {
    const date = new Date(range.start);
    date.setDate(date.getDate() + i * 7);
    cells.push({ key: date.toISOString(), date, left: (i / count) * 100, width: 100 / count });
  }
  return cells;
}
