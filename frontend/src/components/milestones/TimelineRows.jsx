import { useId } from "react";
import { useLocale } from "../../i18n/LocaleProvider";
import { STATUS_META, formatDue, statusMeta } from "./milestoneUtils";
import { DAY_MS, clamp } from "./timelineSchedule";
import { useTaskFileDrop } from "./useTaskFileDrop";

const SHORT_DATE = { month: "short", day: "numeric" };

function percentOf(item) {
  const value = Number(item.completionpercentage || 0);
  return clamp(Number.isFinite(value) ? Math.round(value) : 0, 0, 100);
}

function Chevron({ open }) {
  return (
    <svg className={`tl-chevron${open ? " is-open" : ""}`} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M4 2.2 7.8 6 4 9.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// `interactive` is true where there is a hover: the bar then opens the details
// popover. On touch screens the bar is a picture; the row above it is the control.
export function Bar({ item, span, range, kind, interactive, onHover, onLeave }) {
  const { t } = useLocale();
  const start = span?.start || range.start;
  const end = span?.end || start;
  const left = clamp(((start - range.start) / range.total) * 100, 0, 100);
  const right = clamp(((end - range.start + DAY_MS) / range.total) * 100, left + (kind === "milestone" ? 4 : 1.3), 100);
  const width = Math.max(right - left, kind === "milestone" ? 4 : 1.3);
  const completedTask = kind === "task" && item.status === "Completed";
  const status = kind === "task" ? (completedTask ? "Completed" : "Task") : item.status;
  const meta = statusMeta(status);
  const label = item.name || item.taskname || t("tl.untitled");
  const percent = kind === "milestone" ? percentOf(item) : 0;
  const className = `timeline-bar timeline-bar-${kind} timeline-bar-${meta.className}${completedTask ? " timeline-bar-task-done" : ""}`;
  const style = { left: `${left}%`, width: `${width}%` };
  const content = kind === "milestone" ? (
    <>
      <i className="timeline-bar-fill" style={{ width: `${percent}%` }} />
      <span>{percent}%</span>
    </>
  ) : null;

  if (!interactive) return <div className={className} style={style} aria-hidden="true">{content}</div>;
  return (
    <div
      className={className}
      style={style}
      title={label}
      onMouseEnter={(event) => onHover({ type: kind, item, anchor: event.currentTarget })}
      onMouseLeave={onLeave}
      tabIndex={0}
      onFocus={(event) => onHover({ type: kind, item, anchor: event.currentTarget })}
      onBlur={onLeave}
      role="button"
      aria-label={t("tl.bar_aria", { label, kind: t(kind === "milestone" ? "tl.kind_milestone" : "tl.kind_task") })}
    >
      {content}
    </div>
  );
}

export function PhaseRow({ label, count, open, bodyId, onToggle }) {
  const { t } = useLocale();
  return (
    <div className="tl-row tl-phase-row">
      <div className="tl-label tl-phase-label">
        <button
          type="button"
          className="tl-phase-btn"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          aria-label={t(open ? "tl.hide_phase" : "tl.show_phase", { phase: label })}
          onClick={onToggle}
        >
          <Chevron open={open} />
          <span className="tl-phase-name">{label}</span>
          <span className="tl-phase-count">{t(count === 1 ? "tl.board.milestones_one" : "tl.board.milestones_other", { count })}</span>
        </button>
      </div>
      <div className="tl-track" />
    </div>
  );
}

function TaskRow({ task, milestone, schedule, range, canHover, canManage, onHover, onLeave, onCompleteTask, onOpenDocuments, onDropFiles, actionsOpen, onToggleActions }) {
  const { t, tv } = useLocale();
  const stripId = useId();
  const done = task.status === "Completed";
  const isPlanning = milestone.phase === "Planning";
  const showDone = canManage && isPlanning && !done;
  const showDocs = isPlanning && onOpenDocuments;
  const tappable = !canHover && (showDone || showDocs);
  // A file dragged onto a Planning task is attached straight away. A completed task's documents are locked.
  const { isOver, dropProps } = useTaskFileDrop({
    enabled: isPlanning && Boolean(onDropFiles),
    accepts: !done,
    onFiles: (files) => onDropFiles(task, files),
  });
  const name = task.taskname || t("tl.untitled");
  const label = (
    <>
      <i className="tl-bullet" aria-hidden="true" />
      <span className="tl-task-name">{name}</span>
      {done && <span className="tl-sr">{tv("status", "Completed")}</span>}
      {isOver && <span className="file-drop-hint">{t("docs.drop_here")}</span>}
    </>
  );
  return (
    <div className={`tl-task${isOver ? " is-file-over" : ""}`} {...dropProps}>
      <div className="tl-row tl-task-row">
        <div className="tl-label tl-task-label" title={name}>
          {tappable ? (
            <button type="button" className="tl-task-btn" aria-expanded={actionsOpen} aria-controls={actionsOpen ? stripId : undefined} onClick={onToggleActions}>{label}</button>
          ) : label}
        </div>
        <div className="tl-track">
          <Bar item={task} span={schedule.get(task)} range={range} kind="task" interactive={canHover} onHover={onHover} onLeave={onLeave} />
        </div>
      </div>
      {tappable && actionsOpen && (
        <div className="tl-strip" id={stripId}>
          {showDone && <button type="button" className="tl-action" onClick={() => onCompleteTask?.(task)}>{t("pd.mark_done")}</button>}
          {showDocs && <button type="button" className="tl-action" onClick={() => onOpenDocuments(task)}>{t("tl.documents")}</button>}
        </div>
      )}
    </div>
  );
}

export function MilestoneGroup({ milestone, expanded, onToggle, openTaskKey, onToggleTask, schedule, range, canHover, canManage, hasSiteManager, onHover, onLeave, onAddTask, onCompleteTask, onOpenDocuments, onDropFiles }) {
  const { t, tv, formatDate } = useLocale();
  const uid = useId();
  const tasksId = `${uid}-tasks`;
  const metaId = `${uid}-meta`;
  const meta = statusMeta(milestone.status);
  const tasks = milestone.tasks || [];
  const doneCount = tasks.filter((task) => task.status === "Completed").length;
  const status = tv("status", STATUS_META[milestone.status] ? milestone.status : "Pending");
  const due = t("ms.due", { date: formatDue(milestone, formatDate, SHORT_DATE) });
  const metaText = tasks.length === 0
    ? t("tl.meta_empty", { status, due })
    : t(tasks.length === 1 ? "tl.meta_one" : "tl.meta_other", { status, done: doneCount, total: tasks.length, due });
  const percent = percentOf(milestone);
  return (
    <div className="tl-group">
      <div className="tl-row tl-ms-row">
        <div className="tl-label tl-ms-label">
          <button
            type="button"
            className="tl-ms-btn"
            aria-expanded={expanded}
            aria-controls={expanded ? tasksId : undefined}
            aria-label={t(expanded ? "tl.hide_tasks" : "tl.show_tasks", { name: milestone.name })}
            aria-describedby={metaId}
            onClick={onToggle}
          >
            <Chevron open={expanded} />
            <span className="tl-ms-text">
              <span className="tl-ms-name" title={milestone.name}>{milestone.name}</span>
              <span className="tl-ms-meta" id={metaId}><i className={`tl-dot tl-dot-${meta.className}`} aria-hidden="true" />{metaText}</span>
            </span>
            <span className="tl-ms-pct" aria-hidden="true">{percent}%</span>
          </button>
        </div>
        <div className="tl-track">
          <Bar item={milestone} span={schedule.get(milestone)} range={range} kind="milestone" interactive={canHover} onHover={onHover} onLeave={onLeave} />
        </div>
      </div>
      {expanded && (
        <div className="tl-tasks" id={tasksId}>
          {tasks.map((task) => {
            const key = String(task.taskid ?? task.taskname);
            return (
              <TaskRow
                key={key}
                task={task}
                milestone={milestone}
                schedule={schedule}
                range={range}
                canHover={canHover}
                canManage={canManage}
                onHover={onHover}
                onLeave={onLeave}
                onCompleteTask={onCompleteTask}
                onOpenDocuments={onOpenDocuments}
                onDropFiles={onDropFiles}
                actionsOpen={openTaskKey === key}
                onToggleActions={() => onToggleTask(key)}
              />
            );
          })}
          {tasks.length === 0 && (
            <div className="tl-row tl-note-row">
              <div className="tl-label tl-note">{t("tl.no_tasks_row")}</div>
              <div className="tl-track" />
            </div>
          )}
          {canManage && (
            <div className="tl-row tl-add-row">
              <div className="tl-label tl-add-label">
                {milestone.phase === "Planning" || hasSiteManager ? (
                  <button type="button" className="tl-add-btn" onClick={() => onAddTask?.(milestone)}>+ {t("pd.add_task_btn")}</button>
                ) : (
                  <span className="tl-add-blocked">{t("ms.assign_sm_first")}</span>
                )}
              </div>
              <div className="tl-track" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}