import "./ProgressBar.css";

// Same tone family as Badge's STATUS_TONE map, scoped to the statuses a
// milestone can actually hold (On Track / At Risk / Overdue / Completed).
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
