import { memo, useMemo, useState } from "react";
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

function dateValue(value) {
  const date = asDate(value);
  return date ? date.getTime() : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.Pending;
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
  const first = dates.sort((a, b) => a - b)[0] || new Date();
  const last = dates.sort((a, b) => b - a)[0] || new Date(first.getTime() + 56 * DAY_MS);
  const start = startOfWeek(first);
  const end = endOfWeek(last);
  return { start, end, total: Math.max(DAY_MS, end - start) };
}

function Bar({ item, range, kind, onHover, onLeave }) {
  const start = asDate(item.startdate || item.startDate) || range.start;
  const end = asDate(item.duedate || item.dueDate) || start;
  const left = clamp(((start - range.start) / range.total) * 100, 0, 100);
  const right = clamp(((end - range.start + DAY_MS) / range.total) * 100, left + (kind === "milestone" ? 4 : 1.3), 100);
  const width = Math.max(right - left, kind === "milestone" ? 4 : 1.3);
  const status = kind === "task" ? "Task" : item.status;
  const meta = statusMeta(status);
  const label = item.name || item.taskname || "Untitled";
  return (
    <div
      className={`timeline-bar timeline-bar-${kind} timeline-bar-${meta.className}`}
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

function TaskTooltip({ task }) {
  const meta = statusMeta(task.status);
  return (
    <div className="timeline-tooltip" role="status">
      <strong>{task.taskname}</strong>
      <div className="timeline-tooltip-meta">
        <span className={`timeline-status-dot ${meta.className}`} />
        <span>{task.status || "Pending"}</span>
        <span>Due {DATE.format(asDate(task.duedate) || new Date())}</span>
      </div>
      <p>{task.handledby ? `Handled by: ${task.handledby}` : task.assignedtoname || "Unassigned"}</p>
    </div>
  );
}

function MilestonePopover({ milestone, canManage, onAddTask, onCompleteTask, onOpenDocuments }) {
  const meta = statusMeta(milestone.status);
  return (
    <div className={`timeline-popover timeline-popover-${meta.className}`} role="dialog" aria-label={`${milestone.name} details`}>
      <h3>{milestone.name}</h3>
      <div className="timeline-popover-meta">
        <span className={`timeline-status-pill ${meta.className}`}>{meta.label}</span>
        <span>Due {DATE.format(asDate(milestone.duedate) || new Date())}</span>
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
          milestone.tasks.map((task) => (
            <div className="timeline-popover-task" key={task.taskid || task.taskname}>
              <strong>{task.taskname}</strong>
              <span>Due {DATE.format(asDate(task.duedate) || new Date())} · {task.handledby ? `Handled by: ${task.handledby}` : task.assignedtoname || "Unassigned"}</span>
              {((canManage && task.status !== "Completed") || (milestone.phase === "Planning" && onOpenDocuments)) && (
                <div className="timeline-task-actions">
                  {canManage && task.status !== "Completed" && <button type="button" className="timeline-task-action" onClick={() => onCompleteTask?.(task)}>Mark done</button>}
                  {milestone.phase === "Planning" && onOpenDocuments && <button type="button" className="timeline-task-action" onClick={() => onOpenDocuments(task)}>Documents</button>}
                </div>
              )}
            </div>
          ))
        )}
      </div>
      {canManage && <button type="button" className="timeline-popover-action" onClick={() => onAddTask?.(milestone)}>+ Add Task</button>}
    </div>
  );
}

export const ProjectTimeline = memo(function ProjectTimeline({ project, canManage = false, onAddMilestone, onAddTask, onCompleteTask, onOpenDocuments }) {
  const milestones = Array.isArray(project?.milestones) ? project.milestones : [];
  const [hovered, setHovered] = useState(null);
  const range = useMemo(() => getRange(project, milestones), [project, milestones]);
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

  function leaveBar() {
    window.clearTimeout(leaveBar.timeout);
    leaveBar.timeout = window.setTimeout(() => setHovered(null), 120);
  }

  function enterPopover() {
    window.clearTimeout(leaveBar.timeout);
  }

  function overlayStyle(anchor, width) {
    const track = anchor?.parentElement;
    if (!anchor || !track) return undefined;
    const left = Math.max(8, Math.min(anchor.offsetLeft, track.clientWidth - width - 8));
    return { left: `${left}px`, top: `${anchor.offsetTop + anchor.offsetHeight + 8}px` };
  }

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
                        <Bar item={milestone} range={range} kind="milestone" onHover={setHovered} onLeave={leaveBar} />
                        {hovered?.type === "milestone" && hovered.item === milestone && (
                          <div className="timeline-overlay-popover" style={overlayStyle(hovered.anchor, 286)} onMouseEnter={enterPopover} onMouseLeave={leaveBar}>
                            <MilestonePopover milestone={milestone} canManage={canManage} onAddTask={onAddTask} onCompleteTask={onCompleteTask} onOpenDocuments={onOpenDocuments} />
                          </div>
                        )}
                      </div>
                    </div>
                    {(milestone.tasks || []).map((task) => (
                      <div className="timeline-task-row" key={task.taskid || task.taskname}>
                        <div className="timeline-label-cell timeline-task-label" title={task.taskname}><span>•</span>{task.taskname}</div>
                        <div className="timeline-track">
                          <Bar item={task} range={range} kind="task" onHover={setHovered} onLeave={leaveBar} />
                          {hovered?.type === "task" && hovered.item === task && (
                            <div className="timeline-overlay-tooltip" style={overlayStyle(hovered.anchor, 238)} onMouseEnter={enterPopover} onMouseLeave={leaveBar}>
                              <TaskTooltip task={task} />
                            </div>
                          )}
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
            <div className="timeline-legend"><strong>Status</strong><span><i className="legend-swatch on-track" />On Track</span><span><i className="legend-swatch at-risk" />At Risk</span><span><i className="legend-swatch overdue" />Overdue</span><span><i className="legend-swatch task" />Task</span></div>
            <span className="timeline-footer-today">Today</span>
          </footer>
        </div>
      </div>
    </section>
  );
});
