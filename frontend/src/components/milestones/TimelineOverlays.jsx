import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "../../i18n/LocaleProvider";
import { STATUS_META, assigneeLabel, formatDue, statusMeta } from "./milestoneUtils";

export const DATE_OPTIONS = { month: "short", day: "numeric", year: "numeric" };

// The popover/tooltip is drawn through a portal with position: fixed, measured
// against the viewport. The timeline container clips anything that sticks out of
// it (overflow + contain: paint), which is what hid "+ Add Task" for the bottom
// most milestone. Here it opens below the bar when there is room and flips above
// it when there isn't, and it is always kept inside the screen.
export function FloatingCard({ anchor, width, contentKey, className, onEnter, onLeave, children }) {
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

export function TaskTooltip({ task }) {
  const { t, tv, formatDate } = useLocale();
  const meta = statusMeta(task.status);
  return (
    <div className="timeline-tooltip" role="status">
      <strong>{task.taskname}</strong>
      <div className="timeline-tooltip-meta">
        <span className={`timeline-status-dot ${meta.className}`} />
        <span>{tv("status", task.status || "Pending")}</span>
        <span>{t("ms.due", { date: formatDue(task, formatDate, DATE_OPTIONS) })}</span>
      </div>
      <p>{assigneeLabel(task, t)}</p>
    </div>
  );
}

export function MilestonePopover({ milestone, canManage, onAddTask, onCompleteTask, onOpenDocuments }) {
  const { t, tv, formatDate } = useLocale();
  const meta = statusMeta(milestone.status);
  const isPlanning = milestone.phase === "Planning";
  return (
    <div className={`timeline-popover timeline-popover-${meta.className}`} role="dialog" aria-label={t("tl.details", { name: milestone.name })}>
      <h3>{milestone.name}</h3>
      <div className="timeline-popover-meta">
        <span className={`timeline-status-pill ${meta.className}`}>{tv("status", STATUS_META[milestone.status] ? milestone.status : "Pending")}</span>
        <span>{t("ms.due", { date: formatDue(milestone, formatDate, DATE_OPTIONS) })}</span>
      </div>
      <div className="timeline-popover-progress-head">
        <span>{t("tl.progress")}</span>
        <strong>{Number(milestone.completionpercentage || 0)}%</strong>
      </div>
      <div className="timeline-popover-progress"><span style={{ width: `${Number(milestone.completionpercentage || 0)}%` }} /></div>
      <div className="timeline-popover-tasks">
        {(milestone.tasks || []).length === 0 ? (
          <p className="timeline-popover-empty">{t("ms.no_tasks")}</p>
        ) : (
          milestone.tasks.map((task) => {
            const done = task.status === "Completed";
            return (
              <div className={`timeline-popover-task${done ? " timeline-popover-task-done" : ""}`} key={task.taskid || task.taskname}>
                <strong>{done ? "✓ " : ""}{task.taskname}</strong>
                <span>
                  {done ? tv("status", "Completed") : tv("status", task.status || "Pending")} · {t("ms.due", { date: formatDue(task, formatDate, DATE_OPTIONS) })} · {assigneeLabel(task, t)}
                </span>
                {((canManage && isPlanning && !done) || (isPlanning && onOpenDocuments)) && (
                  <div className="timeline-task-actions">
                    {canManage && isPlanning && !done && <button type="button" className="timeline-task-action" onClick={() => onCompleteTask?.(task)}>{t("pd.mark_done")}</button>}
                    {isPlanning && onOpenDocuments && <button type="button" className="timeline-task-action" onClick={() => onOpenDocuments(task)}>{t("tl.documents")}</button>}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      {canManage && <button type="button" className="timeline-popover-action" onClick={() => onAddTask?.(milestone)}>+ {t("pd.add_task_btn")}</button>}
    </div>
  );
}
