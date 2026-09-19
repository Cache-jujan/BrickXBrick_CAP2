import { Link } from "react-router-dom";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { ProgressBar } from "./ProgressBar";
import "./MilestoneCard.css";

const DATE = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

// Tasks are binary WBS leaf items (F5) — completionpercentage is always
// 0 or 100, so each task's own Badge is enough; no per-task progress bar.
export function MilestoneCard({ milestone, projectId, canManage }) {
  return (
    <Card className="milestone-card">
      <div className="spread milestone-card-head">
        <div>
          <h3 className="milestone-card-name">{milestone.name}</h3>
          <p className="milestone-card-due">Due {DATE.format(new Date(milestone.duedate))}</p>
        </div>
        <Badge status={milestone.status} />
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
            {milestone.tasks.map((task) => (
              <li key={task.taskid} className="milestone-card-task">
                <span className="milestone-card-task-name">{task.taskname}</span>
                <span className="milestone-card-task-due">
                  Due {DATE.format(new Date(task.duedate))}
                </span>
                <Badge status={task.status} />
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <Link
            to={`/projects/${projectId}/milestones/${milestone.milestoneid}/tasks/new`}
            className="milestone-card-add-task"
          >
            + Add Task
          </Link>
        )}
      </div>
    </Card>
  );
}
