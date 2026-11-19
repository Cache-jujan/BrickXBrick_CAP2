import { useState } from "react";
import { Button } from "../ui/Button";
import { useLocale } from "../../i18n/LocaleProvider";
import "./ProgressBreakdownDialog.css";

const DATETIME_OPTIONS = { dateStyle: "medium", timeStyle: "short" };

function isDone(task) {
  return task.status === "Completed";
}

function Ring({ value }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="pb-ring" style={{ "--pb-pct": pct }} role="img" aria-label={`${pct}%`}>
      <span>{pct}%</span>
    </div>
  );
}

function TaskRow({ task, kind, meta, note }) {
  return (
    <li className={`pb-task is-${kind}`}>
      <span className="pb-dot" aria-hidden="true">{kind === "done" ? "✓" : ""}</span>
      <div className="pb-task-body">
        <strong>{task.taskname}</strong>
        {meta && <span className="pb-meta">{meta}</span>}
        {note && <span className="pb-note">{note}</span>}
      </div>
    </li>
  );
}

// What makes up the project's work-progress %: every milestone with the tasks that are done
// (default view), and on request the not-started ones. Reads the overview payload
// the page already has, so it makes no request of its own.
export function ProgressBreakdownDialog({ project, onClose }) {
  const { t, formatDate } = useLocale();
  const [showOthers, setShowOthers] = useState(false);
  const milestones = project.milestones || [];
  const all = milestones.flatMap((m) => m.tasks || []);
  const doneCount = all.filter(isDone).length;
  const pendingCount = all.length - doneCount;
  const overall = Number(project.progress || 0);

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="modal progress-breakdown" role="dialog" aria-modal="true" aria-labelledby="progress-breakdown-title" onClick={(ev) => ev.stopPropagation()}>
        <h2 id="progress-breakdown-title" className="modal-title">{t("pd.progress_breakdown_title")}</h2>

        <div className="pb-summary">
          <Ring value={overall} />
          <div className="pb-stats">
            <div className="pb-stat is-done"><b>{doneCount}</b><span>{t("pd.progress_breakdown_done_section")}</span></div>
            <div className="pb-stat is-pending"><b>{pendingCount}</b><span>{t("pd.progress_breakdown_pending_section")}</span></div>
          </div>
        </div>

        {doneCount === 0 && !showOthers && <p className="modal-body">{t("pd.progress_breakdown_empty")}</p>}

        {milestones.map((milestone) => {
          const tasks = milestone.tasks || [];
          const done = tasks.filter(isDone);
          const others = showOthers ? tasks.filter((task) => !isDone(task)) : [];
          if (done.length === 0 && others.length === 0) return null;
          const pct = Math.round(Number(milestone.completionpercentage || 0));
          return (
            <section className="pb-milestone" key={milestone.milestoneid}>
              <header className="pb-milestone-head">
                <h3>{milestone.name}</h3>
                <span className="pb-chip">{pct}%</span>
              </header>
              <div className="pb-bar"><span style={{ width: `${pct}%` }} /></div>
              <ul className="pb-tasks">
                {done.map((task) => (
                  <TaskRow
                    key={task.taskid}
                    task={task}
                    kind="done"
                    meta={[task.completedat ? formatDate(task.completedat, DATETIME_OPTIONS) : null, task.completedbyname].filter(Boolean).join(" · ")}
                    note={task.completionnote}
                  />
                ))}
                {others.map((task) => (
                  <TaskRow key={task.taskid} task={task} kind="pending" />
                ))}
              </ul>
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
