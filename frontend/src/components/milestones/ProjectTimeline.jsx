import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./ProjectTimeline.css";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_TIMELINE_YEAR = 2000;
const MAX_TIMELINE_YEAR = 2100;
const DATE = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" });
const HEADER_DATE = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric" });

const STATUS_META = {
  "On Track": { className: "on-track", label: "On Track" },
  "At Risk": { className: "at-risk", label: "At Risk" },
  Overdue: { className: "overdue", label: "Overdue" },
  Pending: { className: "pending", label: "Pending" },
  Completed: { className: "completed", label: "Completed" },
};

function asDate(value) {
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.Pending;
}

function dueOf(item) {
  return asDate(item.duedate || item.dueDate);
}

function explicitStartOf(item) {
  return asDate(item.startdate || item.startDate);
}

function byDueDate(a, b) {
  const da = dueOf(a);
  const db = dueOf(b);
  return (da ? da.getTime() : Infinity) - (db ? db.getTime() : Infinity);
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
function buildSchedule(project, milestones) {
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

function getRange(project, milestones) {
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
  const start = startOfWeek(first);
  const end = endOfWeek(last);
  return { start, end, total: Math.max(DAY_MS, end - start) };
}

function assigneeLabel(task) {
  if (task.handledby) return `Handled by: ${task.handledby}`;
  if (task.assignedtoname) return task.assignedtoname;
  return "Unassigned";
}

function Bar({ item, span, range, kind, onHover, onLeave }) {
  const start = span?.start || range.start;
  const end = span?.end || start;
  const left = clamp(((start - range.start) / range.total) * 100, 0, 100);
  const right = clamp(((end - range.start + DAY_MS) / range.total) * 100, left + (kind === "milestone" ? 4 : 1.3), 100);
  const width = Math.max(right - left, kind === "milestone" ? 4 : 1.3);
  const completedTask = kind === "task" && item.status === "Completed";
  const status = kind === "task" ? (completedTask ? "Completed" : "Task") : item.status;
  const meta = statusMeta(status);
  const label = item.name || item.taskname || "Untitled";
  return (
    <div
      className={`timeline-bar timeline-bar-${kind} timeline-bar-${meta.className}${completedTask ? " timeline-bar-task-done" : ""}`}
      style={{ left: `${left}%`, width: `${width}%` }}
      title={label}
      onMouseEnter={(event) => onHover({ type: kind, item, anchor: event.currentTarget })}
      onMouseLeave={onLeave}
      tabIndex={0}
      onFocus={(event) => onHover({ type: kind, item, anchor: event.currentTarget })}
      onBlur={onLeave}
      role="button"
      aria-label={`${label}, ${kind}`}
    >
      <span>{label}</span>
    </div>
  );
}

// The popover/tooltip is drawn through a portal with position: fixed, measured
// against the viewport. The timeline container clips anything that sticks out of
// it (overflow + contain: paint), which is what hid "+ Add Task" for the bottom
// most milestone. Here it opens below the bar when there is room and flips above
// it when there isn't, and it is always kept inside the screen.
function FloatingCard({ anchor, width, contentKey, className, onEnter, onLeave, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    function place() {
      if (!anchor || !ref.current) return;
      const rect = anchor.getBoundingClientRect();
      const height = ref.current.offsetHeight;
      const gap = 8;
      const margin = 8;
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
      const below = rect.bottom + gap;
      const above = rect.top - gap - height;
      let top;
      if (below + height <= window.innerHeight - margin) top = below;
      else if (above >= margin) top = above;
      else top = Math.max(margin, window.innerHeight - height - margin);
      setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, width, contentKey]);

  return createPortal(
    <div
      ref={ref}
      className={className}
      style={{ position: "fixed", left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {children}
    </div>,
    document.body
  );
}

function TaskTooltip({ task }) {
  const meta = statusMeta(task.status);
  return (
    <div className="timeline-tooltip" role="status">
      <strong>{task.taskname}</strong>
      <div className="timeline-tooltip-meta">
        <span className={`timeline-status-dot ${meta.className}`} />
        <span>{task.status || "Pending"}</span>
        <span>Due {DATE.format(dueOf(task) || new Date())}</span>
      </div>
      <p>{assigneeLabel(task)}</p>
    </div>
  );
}

function MilestonePopover({ milestone, canManage, onAddTask, onCompleteTask, onOpenDocuments }) {
  const meta = statusMeta(milestone.status);
  const isPlanning = milestone.phase === "Planning";
  return (
    <div className={`timeline-popover timeline-popover-${meta.className}`} role="dialog" aria-label={`${milestone.name} details`}>
      <h3>{milestone.name}</h3>
      <div className="timeline-popover-meta">
        <span className={`timeline-status-pill ${meta.className}`}>{meta.label}</span>
        <span>Due {DATE.format(dueOf(milestone) || new Date())}</span>
      </div>
      <div className="timeline-popover-progress-head">
        <span>Progress</span>
        <strong>{Number(milestone.completionpercentage || 0)}%</strong>
      </div>
      <div className="timeline-popover-progress"><span style={{ width: `${Number(milestone.completionpercentage || 0)}%` }} /></div>
      <div className="timeline-popover-tasks">
        {(milestone.tasks || []).length === 0 ? (
          <p className="timeline-popover-empty">No tasks yet.</p>
        ) : (
          milestone.tasks.map((task) => {
            const done = task.status === "Completed";
            return (
              <div className={`timeline-popover-task${done ? " timeline-popover-task-done" : ""}`} key={task.taskid || task.taskname}>
                <strong>{done ? "✓ " : ""}{task.taskname}</strong>
                <span>
                  {done ? "Completed" : task.status || "Pending"} · Due {DATE.format(dueOf(task) || new Date())} · {assigneeLabel(task)}
                </span>
                {((canManage && isPlanning && !done) || (isPlanning && onOpenDocuments)) && (
                  <div className="timeline-task-actions">
                    {canManage && isPlanning && !done && <button type="button" className="timeline-task-action" onClick={() => onCompleteTask?.(task)}>Mark done</button>}
                    {isPlanning && onOpenDocuments && <button type="button" className="timeline-task-action" onClick={() => onOpenDocuments(task)}>Documents</button>}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      {canManage && <button type="button" className="timeline-popover-action" onClick={() => onAddTask?.(milestone)}>+ Add Task</button>}
    </div>
  );
}

export const ProjectTimeline = memo(function ProjectTimeline({ project, canManage = false, onAddMilestone, onAddTask, onCompleteTask, onOpenDocuments }) {
  const milestones = useMemo(() => (Array.isArray(project?.milestones) ? project.milestones : []), [project]);
  const [hovered, setHovered] = useState(null);
  const leaveTimer = useRef(null);
  const range = useMemo(() => getRange(project, milestones), [project, milestones]);
  const schedule = useMemo(() => buildSchedule(project, milestones), [project, milestones]);
  const weeks = useMemo(() => {
    const result = [];
    for (let cursor = new Date(range.start); cursor <= range.end; cursor = new Date(cursor.getTime() + 7 * DAY_MS)) result.push(cursor);
    return result;
  }, [range]);
  const phases = [
    { id: "Planning", label: "Pre-construction", items: milestones.filter((m) => m.phase === "Planning") },
    { id: "Construction", label: "Construction", items: milestones.filter((m) => m.phase !== "Planning") },
  ].filter((phase) => phase.items.length > 0);
  const today = new Date();
  const todayPosition = clamp(((today - range.start) / range.total) * 100, 0, 100);

  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  function leaveBar() {
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setHovered(null), 160);
  }

  function enterPopover() {
    window.clearTimeout(leaveTimer.current);
  }

  const hoveredMilestone = hovered?.type === "milestone" ? hovered.item : null;
  const hoveredTask = hovered?.type === "task" ? hovered.item : null;

  return (
    <section className="project-timeline" aria-labelledby="project-timeline-title">
      <header className="project-timeline-header">
        <div>
          <h2 id="project-timeline-title">Project Timeline</h2>
          <p>Swimlanes by phase · hover a milestone bar for details</p>
        </div>
        {canManage && <button type="button" className="project-timeline-add" onClick={onAddMilestone}>+ Add milestone</button>}
      </header>

      <div className="project-timeline-scroll">
        <div className="project-timeline-canvas" style={{ "--week-count": weeks.length }}>
          <div className="timeline-grid-header">
            <div className="timeline-label-cell timeline-label-heading">Phase / milestone</div>
            <div className="timeline-dates">
              {weeks.map((week) => <div className="timeline-date" key={week.toISOString()}>{HEADER_DATE.format(week)}</div>)}
            </div>
          </div>

          <div className="timeline-body">
            <div className="timeline-today-line" style={{ left: `calc(220px + (100% - 220px) * ${todayPosition / 100})` }} aria-hidden="true">
              <span>TODAY</span>
            </div>
            {phases.length === 0 && (
              <div className="timeline-empty-timeline">No milestones yet. Use <strong>+ Add milestone</strong> to start planning this project.</div>
            )}
            {phases.map((phase) => (
              <div className="timeline-phase" key={phase.id}>
                <div className="timeline-phase-row"><div className="timeline-label-cell timeline-phase-label">{phase.label}</div><div className="timeline-track timeline-phase-track" /></div>
                {phase.items.map((milestone) => (
                  <div className="timeline-milestone-group" key={milestone.milestoneid || milestone.name}>
                    <div className="timeline-milestone-row">
                      <div className="timeline-label-cell timeline-milestone-label" title={milestone.name}>{milestone.name}</div>
                      <div className="timeline-track">
                        <Bar item={milestone} span={schedule.get(milestone)} range={range} kind="milestone" onHover={setHovered} onLeave={leaveBar} />
                      </div>
                    </div>
                    {(milestone.tasks || []).map((task) => (
                      <div className="timeline-task-row" key={task.taskid || task.taskname}>
                        <div className="timeline-label-cell timeline-task-label" title={task.taskname}><span>•</span>{task.taskname}</div>
                        <div className="timeline-track">
                          <Bar item={task} span={schedule.get(task)} range={range} kind="task" onHover={setHovered} onLeave={leaveBar} />
                        </div>
                      </div>
                    ))}
                    {(milestone.tasks || []).length === 0 && <div className="timeline-empty-row"><div className="timeline-label-cell">No tasks yet</div><div className="timeline-track" /></div>}
                  </div>
                ))}
              </div>
            ))}
          </div>

          <footer className="project-timeline-footer">
            <div className="timeline-legend"><strong>Status</strong><span><i className="legend-swatch on-track" />On Track</span><span><i className="legend-swatch at-risk" />At Risk</span><span><i className="legend-swatch overdue" />Overdue</span><span><i className="legend-swatch task" />Task</span><span><i className="legend-swatch on-track" />Done task</span></div>
            <span className="timeline-footer-today">Today</span>
          </footer>
        </div>
      </div>

      {hoveredMilestone && (
        <FloatingCard
          anchor={hovered.anchor}
          width={286}
          contentKey={(hoveredMilestone.tasks || []).length}
          className="timeline-overlay-popover"
          onEnter={enterPopover}
          onLeave={leaveBar}
        >
          <MilestonePopover milestone={hoveredMilestone} canManage={canManage} onAddTask={onAddTask} onCompleteTask={onCompleteTask} onOpenDocuments={onOpenDocuments} />
        </FloatingCard>
      )}
      {hoveredTask && (
        <FloatingCard anchor={hovered.anchor} width={238} contentKey={hoveredTask.status} className="timeline-overlay-tooltip" onEnter={enterPopover} onLeave={leaveBar}>
          <TaskTooltip task={hoveredTask} />
        </FloatingCard>
      )}
    </section>
  );
});