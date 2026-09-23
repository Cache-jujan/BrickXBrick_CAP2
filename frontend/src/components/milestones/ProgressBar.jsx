import "./ProgressBar.css";

// Milestone status is server-derived (deriveStatus in milestoneProgress.js)
// from due-date proximity + completion % — never set by the frontend.
// This just picks a fill color to match Badge's tone for the same status.
const FILL_TONE = {
  "On Track": "active",
  Completed: "active",
  "At Risk": "risk",
  Overdue: "overdue",
};

export function ProgressBar({ value = 0, status }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const tone = FILL_TONE[status] || "active";

  return (
    <div
      className="progress-bar"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`progress-bar-fill progress-bar-fill-${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
