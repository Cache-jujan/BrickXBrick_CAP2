// Shared notification presentation: per-type icon + accent colour, relative
// time, day-grouping, and the click-through routing map. Used by both the
// Topbar dropdown and the /notifications page so they never drift apart.
import {
  TicketGlyph,
  CheckCircleGlyph,
  XCircleGlyph,
  ClockAlertGlyph,
  ReceiptXGlyph,
  ShieldAlertGlyph,
  ClipboardGlyph,
  RocketGlyph,
  RefreshGlyph,
  FolderIcon,
} from "../components/layout/icons";

// type -> { Icon, bg, fg, fallback } — fallback only shows if the backend's
// message is ever empty; every current producer always sends a message.
export const NOTIFICATION_META = {
  TicketSubmitted:     { Icon: TicketGlyph,      bg: "#EAF2FF", fg: "#2563EB", fallback: "A new request was submitted." },
  TicketAcknowledged:  { Icon: TicketGlyph,      bg: "#FFF0E6", fg: "#EA580C", fallback: "A request was acknowledged." },
  TicketResolved:      { Icon: CheckCircleGlyph, bg: "#DCFCE7", fg: "#16A34A", fallback: "A request was resolved." },
  TicketRejected:      { Icon: XCircleGlyph,     bg: "#FFF5F3", fg: "#B42318", fallback: "A request was rejected." },
  ScheduleVarianceAlert: { Icon: ClockAlertGlyph, bg: "#FFF7E0", fg: "#B45309", fallback: "A milestone is behind schedule." },
  ExpenseRejected:     { Icon: ReceiptXGlyph,    bg: "#FFF5F3", fg: "#B42318", fallback: "An expense was rejected." },
  TamperAlert:         { Icon: ShieldAlertGlyph, bg: "#FDE8E8", fg: "#9F1239", fallback: "A record integrity issue was found." },
  TaskAssigned:        { Icon: ClipboardGlyph,   bg: "#EAF2FF", fg: "#2563EB", fallback: "A task was assigned to you." },
  ProjectAssigned:     { Icon: FolderIcon,       bg: "#EAF2FF", fg: "#2563EB", fallback: "A project was assigned to you." },
  ProjectActivated:    { Icon: RocketGlyph,      bg: "#DCFCE7", fg: "#16A34A", fallback: "A project was activated." },
  BOMApproved:         { Icon: CheckCircleGlyph, bg: "#DCFCE7", fg: "#16A34A", fallback: "A Bill of Materials was approved." },
  BOMReopened:         { Icon: RefreshGlyph,     bg: "#FFF7E0", fg: "#B45309", fallback: "A Bill of Materials was reopened." },
};

const DEFAULT_META = { Icon: ClipboardGlyph, bg: "#F1F5F9", fg: "#64748B", fallback: "You have a new notification." };

export function metaFor(type) {
  return NOTIFICATION_META[type] || DEFAULT_META;
}

// "5m ago" / "2h ago" / "Yesterday, 4:30 PM" / "Oct 9, 2:10 PM"
export function relativeTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return `Yesterday, ${d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`;
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}

// Buckets notifications into Today / Yesterday / Earlier, preserving the
// newest-first order each list already arrives in.
export function groupByDay(notifications) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const groups = { Today: [], Yesterday: [], Earlier: [] };
  for (const n of notifications) {
    const d = new Date(n.createdat);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) groups.Today.push(n);
    else if (d.getTime() === yesterday.getTime()) groups.Yesterday.push(n);
    else groups.Earlier.push(n);
  }
  return Object.entries(groups).filter(([, items]) => items.length > 0);
}

// Where a click on a notification should navigate, by relatedEntityType +
// the caller's role. Returns null for "mark read only, no navigation".
export function routeForNotification(n, role) {
  const type = n.relatedentitytype;
  if (type === "Ticket") {
    // Only PMs act on the ticket queue from the web app; Purchaser/SM are
    // mobile-only for tickets, so there's nowhere on the web to land them.
    if (role === "Project Manager") return `/tickets/queue?focus=${n.relatedentityid}`;
    return null;
  }
  if (type === "Project") return `/projects/${n.relatedentityid}`;
  if (type === "Milestone") return n.milestone_projectid ? `/projects/${n.milestone_projectid}` : null;
  if (type === "Task") return n.task_projectid ? `/projects/${n.task_projectid}` : null;
  if (type === "Expense") return "/expenses";
  if (n.type === "TamperAlert") return "/blockchain/alerts";
  return null;
}