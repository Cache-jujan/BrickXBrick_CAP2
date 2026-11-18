import { useState } from "react";
import { Button } from "../ui/Button";
import { useLocale } from "../../i18n/LocaleProvider";
import "./ProgressBreakdownDialog.css";

const DATETIME_OPTIONS = { dateStyle: "medium", timeStyle: "short" };

function isDone(task) {
  return task.status === "Completed";
}
function isInProgress(task) {
  return !isDone(task) && (task.status === "In Progress" || Number(task.completionpercentage) > 0);
}

// What makes up the project's work-progress %: every milestone with the tasks that are done
// (default view), and on request the in-progress and pending ones. Reads the overview payload
// the page already has, so it makes no request of its own.
export function ProgressBreakdownDialog({ project, onClose }) {
  const { t, tv, formatDate } = useLocale();
  const [showOthers, setShowOthers] = useState(false);
  const milestones = project.milestones || [];
  const anyDone = milestones.some((m) => (m.tasks || []).some(isDone));

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="modal progress-breakdown" role="dialog" aria-modal="true" aria-labelledby="progress-breakdown-title" onClick={(ev) => ev.stopPropagation()}>
        <h2 id="progress-breakdown-title" className="modal-title">{t("pd.progress_breakdown_title")}</h2>

        {!anyDone && !showOthers && <p className="modal-body">{t("pd.progress_breakdown_empty")}</p>}

        {milestones.map((milestone) => {
          const tasks = milestone.tasks || [];
          const done = tasks.filter(isDone);
          const inProgress = tasks.filter(isInProgress);
          const pending = tasks.filter((task) => !isDone(task) && !isInProgress(task));
          const showDone = done.length > 0;
          const showMore = showOthers && (inProgress.length > 0 || pending.length > 0);
          if (!showDone && !showMore) return null;
          return (
            <section className="progress-breakdown-milestone" key={milestone.milestoneid}>
              <h3 className="progress-breakdown-heading">
                <span>{milestone.name}</span>
                <span className="progress-breakdown-chip">{Math.round(Number(milestone.completionpercentage || 0))}%</span>
              </h3>
              {showDone && (
                <>
                  <p className="progress-breakdown-section">{t("pd.progress_breakdown_done_section")}</p>
                  <ul className="progress-breakdown-list">
                    {done.map((task) => (
                      <li key={task.taskid}>
                        <strong>{task.taskname}</strong>
                        <span className="progress-breakdown-meta">
                          {[task.completedat ? formatDate(task.completedat, DATETIME_OPTIONS) : null, task.completedbyname].filter(Boolean).join(" · ")}
                        </span>
                        {task.completionnote && <span className="progress-breakdown-note">{task.completionnote}</span>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {showMore && inProgress.length > 0 && (
                <>
                  <p className="progress-breakdown-section">{t("pd.progress_breakdown_inprogress_section")}</p>
                  <ul className="progress-breakdown-list">
                    {inProgress.map((task) => (
                      <li key={task.taskid}>
                        <strong>{task.taskname}</strong>
                        <span className="progress-breakdown-meta">{Math.round(Number(task.completionpercentage || 0))}%</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {showMore && pending.length > 0 && (
                <>
                  <p className="progress-breakdown-section">{t("pd.progress_breakdown_pending_section")}</p>
                  <ul className="progress-breakdown-list">
                    {pending.map((task) => (
                      <li key={task.taskid}>
                        <strong>{task.taskname}</strong>
                        <span className="progress-breakdown-meta">{tv("status", task.status || "Pending")}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          );
        })}

        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setShowOthers((v) => !v)} aria-pressed={showOthers}>
            {t("pd.progress_breakdown_toggle")}
          </Button>
          <Button onClick={onClose}>{t("pd.close")}</Button>
        </div>
      </div>
    </div>
  );
}
