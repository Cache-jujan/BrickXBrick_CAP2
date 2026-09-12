import "./Badge.css";

// Maps backend status strings to a visual tone. Falls back to "neutral"
// for anything unrecognized so a new status value never renders broken.
const STATUS_TONE = {
  Active: "active",
  "On Track": "active",
  Approved: "active",
  Completed: "neutral",
  "At Risk": "risk",
  Pending: "risk",
  Draft: "neutral",
  Overdue: "overdue",
  Rejected: "overdue",
  Inactive: "inactive",
  Archived: "inactive",
};

export function Badge({ status, children }) {
  const tone = STATUS_TONE[status] || "neutral";
  return <span className={`badge badge-${tone}`}>{children || status}</span>;
}
