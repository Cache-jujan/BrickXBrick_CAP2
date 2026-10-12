import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { ProgressBar } from "./ProgressBar";
import "./MilestoneCard.css";

const DATE = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

// A task is overdue when its due date has passed and it isn't Completed yet.
// Task status is only ever Pending or Completed (see note below), so "overdue"
// is derived here from the date rather than being a status the backend sends.
// Compared at day granularity: a task due today is not overdue.
function taskIsOverdue(task) {
  if (task.status === "Completed") return false;
  const due = new Date(task.duedate);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return due < today;
}

// Tasks only ever move Pending -> Completed through the F5 review flow
// (SM submits a photo on mobile, PM acknowledges) — nothing on this page
// can change a task's status, so each task is shown as read-only: name,
// due date, and its current Badge. No photo/review action here.
export function MilestoneCard({ milestone, canManage, hasSiteManager, onAddTask }) {
  // #14: review state from /overview. Flagged takes priority over awaiting —
  // a flagged submission needs the Site Manager to resubmit before the PM can
  // act, so it's the more urgent signal.
  const flaggedCount = Number(milestone.flagged || 0);
  const awaitingCount = Number(milestone.awaitingReview || milestone.awaitingreview || 0);
  const reviewChip = flaggedCount > 0
    ? { tone: "Overdue", label: "Needs resubmit" }
    : awaitingCount > 0
    ? { tone: "Pending", label: "Awaiting review" }
    : null;

  return (
    <Card className="milestone-card">
      <div className="spread milestone-card-head">
        <div>
          <h3 className="milestone-card-name">{milestone.name}</h3>
          <p className="milestone-card-due">Due {DATE.format(new Date(milestone.duedate))}</p>
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
          <p className="milestone-card-empty">No tasks yet.</p>
        ) : (
          <ul className="milestone-card-task-list">
            {milestone.tasks.map((task) => {
              const overdue = taskIsOverdue(task);
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
                      Due {DATE.format(new Date(task.duedate))}
                    </span>
                    <span className="milestone-card-task-badges">
                      {overdue && <Badge status="Overdue" />}
                      <Badge status={task.status} />
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {canManage &&
          (hasSiteManager ? (
            <button
              type="button"
              className="milestone-card-add-task"
              onClick={() => onAddTask?.(milestone)}
            >
              + Add Task
            </button>
          ) : (
            // Backend 400s POST /:id/tasks when project.siteManagerId is
            // null — catch it here instead of letting the PM hit a dead
            // end on the create-task page.
            <p className="milestone-card-add-task-blocked">
              Assign a Site Manager to this project before adding tasks.
            </p>
          ))}
      </div>
    </Card>
  );
}