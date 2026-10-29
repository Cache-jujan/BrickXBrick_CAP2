import { memo, useMemo } from "react";
import { useLocale } from "../../i18n/LocaleProvider";
import { STATUS_META, assigneeLabel, byDueDate, formatDue, statusMeta, taskIsOverdue } from "./milestoneUtils";
import { useTaskFileDrop } from "./useTaskFileDrop";
import "./MilestoneBoard.css";

function percentOf(milestone) {
  const value = Number(milestone.completionpercentage || 0);
  return Math.max(0, Math.min(100, Number.isFinite(value) ? Math.round(value) : 0));
}

// "GM" / "PM" are already initials; a person's name gives the first letters of up to two words.
function initialsOf(task) {
  const wordsInitials = (name) => String(name).trim().split(/\s+/).slice(0, 2).map((word) => word.charAt(0)).join("").toUpperCase();
  const handler = task.handledby ? String(task.handledby).trim() : "";
  if (handler) return handler.length <= 3 ? handler.toUpperCase() : wordsInitials(handler);
  return (task.assignedtoname && wordsInitials(task.assignedtoname)) || "–";
}

function TaskChip({ task }) {
  const { t } = useLocale();
  if (task.status === "Completed") {
    return (
      <span className="board-chip board-chip-done">
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false"><path d="M2.2 6.4 4.8 9l5-5.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {t("common.done_status")}
      </span>
    );
  }
  if (taskIsOverdue(task)) return <span className="board-chip board-chip-overdue">{t("common.overdue")}</span>;
  return <span className="board-chip board-chip-pending">{t("common.pending")}</span>;
}

function BoardTask({ task, milestone, canManage, onCompleteTask, onOpenDocuments, onDropFiles }) {
  const { t, formatDate } = useLocale();
  const done = task.status === "Completed";
  const isPlanning = milestone.phase === "Planning";
  const showDone = canManage && isPlanning && !done;
  const showDocs = isPlanning && onOpenDocuments;
  // A file dragged onto a Planning task card is attached straight away. A completed task's documents are locked.
  const { isOver, dropProps } = useTaskFileDrop({
    enabled: isPlanning && Boolean(onDropFiles),
    accepts: !done,
    onFiles: (files) => onDropFiles(task, files),
  });
  return (
    <li className={`board-task${isOver ? " is-file-over" : ""}`} {...dropProps}>
      <strong className="board-task-name">{task.taskname}</strong>
      {isOver && <span className="file-drop-hint">{t("docs.drop_here")}</span>}
      <div className="board-task-row">
        <TaskChip task={task} />
        <span>{t("ms.due", { date: formatDue(task, formatDate, { month: "short", day: "numeric" }) })}</span>
      </div>
      <div className="board-task-row">
        <span className="board-avatar" aria-hidden="true">{initialsOf(task)}</span>
        <span>{assigneeLabel(task, t)}</span>
      </div>
      {(showDone || showDocs) && (
        <div className="board-task-actions">
          {showDone && <button type="button" className="board-action" onClick={() => onCompleteTask?.(task)}>{t("pd.mark_done")}</button>}
          {showDocs && <button type="button" className="board-action" onClick={() => onOpenDocuments(task)}>{t("tl.documents")}</button>}
        </div>
      )}
    </li>
  );
}

function BoardColumn({ milestone, phaseLabel, index, canManage, hasSiteManager, onAddTask, onCompleteTask, onOpenDocuments, onDropFiles }) {
  const { t, tv, formatDate } = useLocale();
  const meta = statusMeta(milestone.status);
  const tasks = milestone.tasks || [];
  const percent = percentOf(milestone);
  const headingId = `board-col-${index}`;
  // The backend rejects a task on a Construction milestone until the project has a Site Manager (same rule as MilestoneCard).
  const canAddTask = canManage && (milestone.phase === "Planning" || hasSiteManager);
  return (
    <section className={`board-column board-column-${meta.className}`} aria-labelledby={headingId}>
      <header className="board-column-header">
        <span className="board-column-phase">{phaseLabel}</span>
        <h3 id={headingId}>{milestone.name}</h3>
        <div className="board-column-status">
          <span className={`board-pill board-pill-${meta.className}`}>{tv("status", STATUS_META[milestone.status] ? milestone.status : "Pending")}</span>
          <span>{t("ms.due", { date: formatDue(milestone, formatDate) })}</span>
        </div>
        <div className="board-progress">
          <div className="board-progress-track" role="progressbar" aria-label={t("tl.progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span style={{ width: `${percent}%` }} />
          </div>
          <span className="board-progress-value">{percent}%</span>
        </div>
        <div className="board-column-foot">
          <span>{t(tasks.length === 1 ? "tl.board.task_one" : "tl.board.task_other", { count: tasks.length })}</span>
          {canAddTask && <button type="button" className="board-link" onClick={() => onAddTask?.(milestone)}>+ {t("pd.add_task_btn")}</button>}
        </div>
        {canManage && !canAddTask && <p className="board-add-blocked">{t("ms.assign_sm_first")}</p>}
      </header>
      {tasks.length === 0 ? (
        <p className="board-empty">{t("ms.no_tasks")}</p>
      ) : (
        <ul className="board-tasks" role="list" aria-labelledby={headingId}>
          {tasks.map((task) => (
            <BoardTask
              key={task.taskid || task.taskname}
              task={task}
              milestone={milestone}
              canManage={canManage}
              onCompleteTask={onCompleteTask}
              onOpenDocuments={onOpenDocuments}
              onDropFiles={onDropFiles}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export const MilestoneBoard = memo(function MilestoneBoard({ milestones, canManage = false, hasSiteManager = false, onAddTask, onCompleteTask, onOpenDocuments, onDropFiles }) {
  const { t } = useLocale();
  const groups = useMemo(() => {
    const planning = milestones.filter((m) => m.phase === "Planning").sort(byDueDate);
    const construction = milestones.filter((m) => m.phase !== "Planning").sort(byDueDate);
    return [
      { id: "Planning", label: t("tl.pre_construction"), items: planning },
      { id: "Construction", label: t("projects.construction"), items: construction },
    ].filter((group) => group.items.length > 0);
  }, [milestones, t]);

  if (groups.length === 0) return <p className="board-empty board-empty-project">{t("tl.board.empty_project")}</p>;

  let index = 0;
  return (
    <div className="board">
      <div className="board-meta">
        <strong>{t(milestones.length === 1 ? "tl.board.milestones_one" : "tl.board.milestones_other", { count: milestones.length })}</strong>
        <span>{t("tl.board.swipe")}</span>
      </div>
      <div className="board-scroll" role="region" aria-label={t("tl.board.region")} tabIndex={0}>
        <div className="board-strip">
          {groups.map((group) => (
            <div className="board-group" key={group.id}>
              <div className="board-phase">{group.label}</div>
              <div className="board-columns">
                {group.items.map((milestone) => (
                  <BoardColumn
                    key={milestone.milestoneid || milestone.name}
                    milestone={milestone}
                    phaseLabel={group.label}
                    index={index++}
                    canManage={canManage}
                    hasSiteManager={hasSiteManager}
                    onAddTask={onAddTask}
                    onCompleteTask={onCompleteTask}
                    onOpenDocuments={onOpenDocuments}
                    onDropFiles={onDropFiles}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});