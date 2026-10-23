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

type Meta = { icon: IconName; bg: string; fg: string; fallback: string };

const META: Record<string, Meta> = {
  TicketSubmitted:       { icon: "ticket.fill",      bg: "#EAF2FF", fg: "#2563EB", fallback: "A new request was submitted." },
  TicketAcknowledged:    { icon: "ticket.fill",      bg: "#FFF0E6", fg: "#EA580C", fallback: "A request was acknowledged." },
  TicketResolved:        { icon: "checkmark.circle.fill", bg: "#DCFCE7", fg: "#16A34A", fallback: "A request was resolved." },
  TicketRejected:        { icon: "xmark.circle.fill",     bg: "#FFF5F3", fg: "#B42318", fallback: "A request was rejected." },
  ScheduleVarianceAlert: { icon: "clock.fill",       bg: "#FFF7E0", fg: "#B45309", fallback: "A milestone is behind schedule." },
  ExpenseRejected:       { icon: "receipt",          bg: "#FFF5F3", fg: "#B42318", fallback: "An expense was rejected." },
  TamperAlert:           { icon: "shield.lefthalf.filled", bg: "#FDE8E8", fg: "#9F1239", fallback: "A record integrity issue was found." },
  TaskAssigned:          { icon: "list.clipboard.fill", bg: "#EAF2FF", fg: "#2563EB", fallback: "A task was assigned to you." },
  TaskAcknowledged:      { icon: "checkmark.circle.fill", bg: "#DCFCE7", fg: "#16A34A", fallback: "Your task photo was accepted." },
  TaskFlagged:           { icon: "xmark.circle.fill",     bg: "#FFF5F3", fg: "#B42318", fallback: "Your task photo was flagged." },
  CheckinFlagged:        { icon: "xmark.circle.fill",     bg: "#FFF5F3", fg: "#B42318", fallback: "Your Project Manager flagged a check-in." },
  ProjectAssigned:       { icon: "folder.fill",      bg: "#EAF2FF", fg: "#2563EB", fallback: "A project was assigned to you." },
  ProjectActivated:      { icon: "arrow.up.forward.circle.fill", bg: "#DCFCE7", fg: "#16A34A", fallback: "A project was activated." },
  BOMApproved:           { icon: "checkmark.circle.fill", bg: "#DCFCE7", fg: "#16A34A", fallback: "A Bill of Materials was approved." },
  BOMReopened:           { icon: "arrow.triangle.2.circlepath.circle", bg: "#FFF7E0", fg: "#B45309", fallback: "A Bill of Materials was reopened." },
};

const DEFAULT_META: Meta = { icon: "list.clipboard.fill", bg: "#F1E9DD", fg: "#8A7F6E", fallback: "You have a new notification." };

export function metaFor(type: string): Meta {
  return META[type] || DEFAULT_META;
}

export function relativeTime(iso: string): string {
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
  if (type === "Checkin" && role === "Site Manager") return "/site-manager/checkin" as Href;
  // Milestone/Project/Expense/TamperAlert: no mobile screen for these yet —
  // mark read only (mirrors the web app's "Unknown -> mark read only").
  return null;
}