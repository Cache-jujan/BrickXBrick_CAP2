// Shared notification presentation for mobile: per-type icon + accent colour,
// relative time, day-grouping, and tap routing. Mirrors
// frontend/src/utils/notificationMeta.js so the same event looks and routes
// the same way on web and mobile — just rendered with IconSymbol instead of
// inline SVGs.
import type { Href } from "expo-router";

import type { AppNotification } from "./api";

type IconName =
  | "ticket.fill"
  | "checkmark.circle.fill"
  | "xmark.circle.fill"
  | "clock.fill"
  | "receipt"
  | "shield.lefthalf.filled"
  | "list.clipboard.fill"
  | "folder.fill"
  | "arrow.up.forward.circle.fill"
  | "arrow.triangle.2.circlepath.circle";

// `fallbackKey` is a message-catalog key; the screen translates it with useLocale().
type Meta = { icon: IconName; bg: string; fg: string; fallbackKey: string };

const META: Record<string, Meta> = {
  TicketSubmitted:       { icon: "ticket.fill",      bg: "#EAF2FF", fg: "#2563EB", fallbackKey: "notif.fallback.ticket_submitted" },
  TicketAcknowledged:    { icon: "ticket.fill",      bg: "#FFF0E6", fg: "#EA580C", fallbackKey: "notif.fallback.ticket_acknowledged" },
  TicketResolved:        { icon: "checkmark.circle.fill", bg: "#DCFCE7", fg: "#16A34A", fallbackKey: "notif.fallback.ticket_resolved" },
  TicketRejected:        { icon: "xmark.circle.fill",     bg: "#FFF5F3", fg: "#B42318", fallbackKey: "notif.fallback.ticket_rejected" },
  ScheduleVarianceAlert: { icon: "clock.fill",       bg: "#FFF7E0", fg: "#B45309", fallbackKey: "notif.fallback.schedule_variance" },
  ExpenseRejected:       { icon: "receipt",          bg: "#FFF5F3", fg: "#B42318", fallbackKey: "notif.fallback.expense_rejected" },
  ExpenseApproved:       { icon: "checkmark.circle.fill", bg: "#DCFCE7", fg: "#16A34A", fallbackKey: "notif.fallback.expense_approved" },
  TamperAlert:           { icon: "shield.lefthalf.filled", bg: "#FDE8E8", fg: "#9F1239", fallbackKey: "notif.fallback.tamper_alert" },
  TaskAssigned:          { icon: "list.clipboard.fill", bg: "#EAF2FF", fg: "#2563EB", fallbackKey: "notif.fallback.task_assigned" },
  TaskAcknowledged:      { icon: "checkmark.circle.fill", bg: "#DCFCE7", fg: "#16A34A", fallbackKey: "notif.fallback.task_acknowledged" },
  TaskFlagged:           { icon: "xmark.circle.fill",     bg: "#FFF5F3", fg: "#B42318", fallbackKey: "notif.fallback.task_flagged" },
  CheckinFlagged:        { icon: "xmark.circle.fill",     bg: "#FFF5F3", fg: "#B42318", fallbackKey: "notif.fallback.checkin_flagged_sm" },
  ProjectAssigned:       { icon: "folder.fill",      bg: "#EAF2FF", fg: "#2563EB", fallbackKey: "notif.fallback.project_assigned" },
  ProjectActivated:      { icon: "arrow.up.forward.circle.fill", bg: "#DCFCE7", fg: "#16A34A", fallbackKey: "notif.fallback.project_activated" },
  ReceiptScanReady:      { icon: "checkmark.circle.fill", bg: "#DCFCE7", fg: "#16A34A", fallbackKey: "notif.fallback.scan_ready" },
  ReceiptScanFailed:     { icon: "xmark.circle.fill",     bg: "#FFF5F3", fg: "#B42318", fallbackKey: "notif.fallback.scan_failed" },
  BOMApproved:           { icon: "checkmark.circle.fill", bg: "#DCFCE7", fg: "#16A34A", fallbackKey: "notif.fallback.bom_approved" },
  BOMReopened:           { icon: "arrow.triangle.2.circlepath.circle", bg: "#FFF7E0", fg: "#B45309", fallbackKey: "notif.fallback.bom_reopened" },
};

const DEFAULT_META: Meta = { icon: "list.clipboard.fill", bg: "#F1E9DD", fg: "#8A7F6E", fallbackKey: "notif.fallback.default" };

export function metaFor(type: string): Meta {
  return META[type] || DEFAULT_META;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

// Types whose wording the app writes itself, in the user's language, instead of the
// English text stored by the server.
const LOCALIZED_TYPES = new Set(["ReceiptScanReady", "ReceiptScanFailed"]);

// The text to show for a notification (list and pop-up).
export function notificationText(n: AppNotification, t: Translate): string {
  const { fallbackKey } = metaFor(n.type);
  if (LOCALIZED_TYPES.has(n.type)) return t(fallbackKey);
  return n.message || t(fallbackKey);
}

// `t` and `intlLocale` come from useLocale() so the wording and month names follow the language.
export function relativeTime(iso: string, t: Translate, intlLocale = "en-PH"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString(intlLocale, { hour: "numeric", minute: "2-digit" });
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return t("time.just_now");
  if (mins < 60) return t("time.minutes_ago", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("time.hours_ago", { count: hours });
  const days = Math.floor(hours / 24);
  if (days === 1) return t("time.yesterday_at", { time });
  if (days < 7) return t("time.days_ago", { count: days });
  return `${d.toLocaleDateString(intlLocale, { month: "short", day: "numeric" })}, ${time}`;
}

export function groupByDay(notifications: AppNotification[]): [string, AppNotification[]][] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const groups: Record<"Today" | "Yesterday" | "Earlier", AppNotification[]> = { Today: [], Yesterday: [], Earlier: [] };
  for (const n of notifications) {
    const d = new Date(n.createdat);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) groups.Today.push(n);
    else if (d.getTime() === yesterday.getTime()) groups.Yesterday.push(n);
    else groups.Earlier.push(n);
  }
  return (Object.entries(groups) as [string, AppNotification[]][]).filter(([, items]) => items.length > 0);
}

// Where tapping a notification should go, for the given role. Returns null
// for "mark read only, no navigation" — matches the web app's routing map.
// Return type is Href (not string): with Expo Router's typed routes generated
// (.expo/types/router.d.ts — present once `expo start` has run locally), a
// function that returns plain `string` gets widened past the generated route
// union and every call site's router.push/replace fails to type-check. Each
// of these is a route we know is valid, so it's asserted `as Href` here —
// once, at the source — rather than cast at every call site.
export function routeForNotification(n: AppNotification, role: "Purchaser" | "Site Manager"): Href | null {
  const type = n.relatedentitytype;
  if (type === "Ticket") {
    if (role === "Site Manager") return `/site-manager/my-requests?focus=${n.relatedentityid}` as Href;
    // Purchaser: their ticket work all happens on the receipts home.
    return "/(tabs)" as Href;
  }
  if (type === "Task" && role === "Site Manager") return `/site-manager/task/${n.relatedentityid}` as Href;
  if (type === "Checkin" && role === "Site Manager") {
    // A flag points at one check-in: open what was sent, with the PM's comment.
    return (n.relatedentityid ? `/site-manager/checkin/${n.relatedentityid}` : "/site-manager/checkin") as Href;
  }
  if (type === "ReceiptScan") {
    // A finished receipt scan: the Purchaser's Turn In tab lists them; a Site Manager's receipts are on the Receipt tab.
    return (role === "Purchaser" ? "/turn-in" : "/(tabs)") as Href;
  }
  // Milestone/Project/Expense/TamperAlert: no mobile screen for these yet —
  // mark read only (mirrors the web app's "Unknown -> mark read only").
  return null;
}