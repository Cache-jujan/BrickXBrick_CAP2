import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { ProgressBar } from "./ProgressBar";
import { useLocale } from "../../i18n/LocaleProvider";
import { taskIsOverdue } from "./milestoneUtils";
import "./MilestoneCard.css";

const DATETIME_OPTIONS = { dateStyle: "medium", timeStyle: "short" };

const HANDLER_LABEL = { GM: "General Manager", PM: "Project Manager" };

// A Construction task only ever moves Pending -> Completed through the F5
// review flow (SM submits a photo on mobile, PM acknowledges) — nothing on
// this page can change its status, so it's shown as read-only: name, due
// date, and its current Badge. No photo/review action here.
//
// #5: a Planning-phase milestone's tasks have no SM review flow at all —
// they're "Handled by: GM/PM" and the owning PM closes them out directly
// via onCompleteTask, which is the one action this card can trigger.
export function MilestoneCard({ milestone, canManage, hasSiteManager, onAddTask, onCompleteTask }) {
  const { t, formatDate } = useLocale();
  const isPlanning = milestone.phase === "Planning";

  // #14: review state from /overview. Flagged takes priority over awaiting —
  // a flagged submission needs the Site Manager to resubmit before the PM can
  // act, so it's the more urgent signal. Planning milestones never have this
  // (no photo submissions), so the chip is Construction-only anyway.
  const flaggedCount = Number(milestone.flagged || 0);
  const awaitingCount = Number(milestone.awaitingReview || milestone.awaitingreview || 0);
  const reviewChip = flaggedCount > 0
    ? { tone: "Overdue", label: t("ms.needs_resubmit") }
    : awaitingCount > 0
    ? { tone: "Pending", label: t("ms.awaiting_review") }
    : null;

  return (
    <Card className="milestone-card">
      <div className="spread milestone-card-head">
        <div>
          <h3 className="milestone-card-name">{milestone.name}</h3>
          <p className="milestone-card-due">{t("ms.due", { date: formatDate(milestone.duedate) })}</p>
        </div>
        <div className="milestone-card-badges">
          <Badge status={milestone.status} />
          {reviewChip && <Badge status={reviewChip.tone}>{reviewChip.label}</Badge>}
        </div>
      </div>

      <div className="milestone-card-progress">
        <ProgressBar value={milestone.completionpercentage} status={milestone.status} />
        <span className="milestone-card-progress-value">
          {Number(milestone.completionpercentage || 0)}%
        </span>
      </div>

      <div className="milestone-card-tasks">
        {milestone.tasks.length === 0 ? (
          <p className="milestone-card-empty">{t("ms.no_tasks")}</p>
        ) : (
          <ul className="milestone-card-task-list">
            {milestone.tasks.map((task) => {
              const overdue = taskIsOverdue(task);
              const handledByLabel = task.handledby ? HANDLER_LABEL[task.handledby] || task.handledby : null;
              return (
                <li key={task.taskid} className="milestone-card-task">
                  <span className="milestone-card-task-name">{task.taskname}</span>
                  <div className="milestone-card-task-meta">
                    <span
                      className={
                        "milestone-card-task-due" +
                        (overdue ? " milestone-card-task-due-overdue" : "")
                      }
                    >
                      {t("ms.due", { date: formatDate(task.duedate) })}
                    </span>
                    {handledByLabel && (
                      <span className="milestone-card-task-handler">{t("ms.handled_by", { who: handledByLabel })}</span>
                    )}
                    <span className="milestone-card-task-badges">
                      {overdue && <Badge status="Overdue" />}
                      <Badge status={task.status} />
                    </span>
                  </div>
                  {task.status === "Completed" && task.completedat && (
                    <p className="milestone-card-task-completed-note">
                      {t("mobile.done_date", { date: formatDate(task.completedat, DATETIME_OPTIONS) })}
                      {task.completionnote ? ` — "${task.completionnote}"` : ""}
                    </p>
                  )}
                  {isPlanning && task.status !== "Completed" && canManage && (
                    <button
                      type="button"
                      className="milestone-card-complete-task"
                      onClick={() => onCompleteTask?.(task)}
                    >
                      {t("pd.mark_done")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {canManage &&
          (isPlanning || hasSiteManager ? (
            <button
              type="button"
              className="milestone-card-add-task"
              onClick={() => onAddTask?.(milestone)}
            >
              + {t("pd.add_task_btn")}
            </button>
          ) : (
            // Backend 400s POST /:id/tasks on a Construction milestone when
            // project.siteManagerId is null — catch it here instead of
            // letting the PM hit a dead end on the create-task page. A
            // Planning milestone has no such requirement (handled above).
            <p className="milestone-card-add-task-blocked">
              {t("ms.assign_sm_first")}
            </p>
          ))}
      </div>
    </Card>
  );
}