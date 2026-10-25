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

// type -> { Icon, bg, fg, fallbackKey } — the fallback text only shows if the backend's
// message is ever empty; every current producer always sends a message.
export const NOTIFICATION_META = {
  TicketSubmitted:     { Icon: TicketGlyph,      bg: "#EAF2FF", fg: "#2563EB", fallbackKey: "notif.fallback.ticket_submitted" },
  TicketAcknowledged:  { Icon: TicketGlyph,      bg: "#FFF0E6", fg: "#EA580C", fallbackKey: "notif.fallback.ticket_acknowledged" },
  TicketResolved:      { Icon: CheckCircleGlyph, bg: "#DCFCE7", fg: "#16A34A", fallbackKey: "notif.fallback.ticket_resolved" },
  TicketRejected:      { Icon: XCircleGlyph,     bg: "#FFF5F3", fg: "#B42318", fallbackKey: "notif.fallback.ticket_rejected" },
  ScheduleVarianceAlert: { Icon: ClockAlertGlyph, bg: "#FFF7E0", fg: "#B45309", fallbackKey: "notif.fallback.schedule_variance" },
  ExpenseRejected:     { Icon: ReceiptXGlyph,    bg: "#FFF5F3", fg: "#B42318", fallbackKey: "notif.fallback.expense_rejected" },
  TamperAlert:         { Icon: ShieldAlertGlyph, bg: "#FDE8E8", fg: "#9F1239", fallbackKey: "notif.fallback.tamper_alert" },
  TaskAssigned:        { Icon: ClipboardGlyph,   bg: "#EAF2FF", fg: "#2563EB", fallbackKey: "notif.fallback.task_assigned" },
  TaskAcknowledged:    { Icon: CheckCircleGlyph, bg: "#DCFCE7", fg: "#16A34A", fallbackKey: "notif.fallback.task_acknowledged" },
  TaskFlagged:         { Icon: XCircleGlyph,     bg: "#FFF5F3", fg: "#B42318", fallbackKey: "notif.fallback.task_flagged" },
  CheckinIssue:        { Icon: ClockAlertGlyph, bg: "#FFF7E0", fg: "#B45309", fallbackKey: "notif.fallback.checkin_issue" },
  CheckinFlagged:      { Icon: XCircleGlyph,     bg: "#FFF5F3", fg: "#B42318", fallbackKey: "notif.fallback.checkin_flagged" },
  ProjectAssigned:     { Icon: FolderIcon,       bg: "#EAF2FF", fg: "#2563EB", fallbackKey: "notif.fallback.project_assigned" },
  ProjectActivated:    { Icon: RocketGlyph,      bg: "#DCFCE7", fg: "#16A34A", fallbackKey: "notif.fallback.project_activated" },
  BOMApproved:         { Icon: CheckCircleGlyph, bg: "#DCFCE7", fg: "#16A34A", fallbackKey: "notif.fallback.bom_approved" },
  BOMReopened:         { Icon: RefreshGlyph,     bg: "#FFF7E0", fg: "#B45309", fallbackKey: "notif.fallback.bom_reopened" },
};

const DEFAULT_META = { Icon: ClipboardGlyph, bg: "#F1F5F9", fg: "#64748B", fallbackKey: "notif.fallback.default" };

export function metaFor(type) {
  return NOTIFICATION_META[type] || DEFAULT_META;
}

const TIME_OF_DAY = { hour: "numeric", minute: "2-digit" };

// "5m ago" / "2h ago" / "Yesterday, 4:30 PM" / "Oct 9, 2:10 PM"
// `t` and `formatDate` come from useLocale() so the wording follows the language.
export function relativeTime(iso, t, formatDate) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return t("time.just_now");
  if (mins < 60) return t("time.minutes_ago", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("time.hours_ago", { count: hours });
  const days = Math.floor(hours / 24);
  if (days === 1) return t("time.yesterday_at", { time: formatDate(d, TIME_OF_DAY) });
  if (days < 7) return t("time.days_ago", { count: days });
  return `${formatDate(d, { month: "short", day: "numeric" })}, ${formatDate(d, TIME_OF_DAY)}`;
}

// Buckets notifications into Today / Yesterday / Earlier, preserving the
// newest-first order each list already arrives in. The group names are
// catalog suffixes: translate with tv("notifications.group", name).
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
  if (type === "Checkin") {
    return n.checkin_projectid ? `/projects/${n.checkin_projectid}/checkins?focus=${n.relatedentityid}` : null;
  }
  if (type === "Expense") return "/expenses";
  if (n.type === "TamperAlert") return "/blockchain/alerts";
  if (n.type === "BlockchainOverdue") return "/blockchain/alerts";
  return null;
}