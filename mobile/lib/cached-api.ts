// Offline-first loaders for the screens. Each wraps one server call in
// withCache (lib/sync/offline-cache.js): the server's answer when it can be
// reached, otherwise the copy saved on this phone the last time it worked.
// Every result says whether it came from the saved copy and how old it is.
import { getSession } from "@/lib/auth";
import {
  fetchActiveProjects,
  fetchAllAssignedTickets,
  fetchApprovedVendors,
  fetchAssignedTasks,
  fetchBomItems,
  fetchCheckinDetail,
  fetchCheckinsToday,
  fetchMyExpenses,
  fetchNotifications,
  fetchOpenRequests,
} from "@/lib/api";
import { fetchScans } from "@/lib/receipt-scans";
import { withCache } from "@/lib/sync/offline-cache";

export type Cached<T> = { data: T; fromCache: boolean; savedAt: string };

function cached<T>(key: string, load: () => Promise<T>): Promise<Cached<T>> {
  return withCache(key, getSession()?.user.id ?? null, load);
}

export const loadAssignedTasks = () => cached("tasks:assigned", fetchAssignedTasks);
export const loadAssignedTickets = (role: "Purchaser" | "Site Manager") =>
  cached(`tickets:${role}`, () => fetchAllAssignedTickets(role));
export const loadCheckinsToday = () => cached("checkins:today", fetchCheckinsToday);
export const loadCheckinDetail = (checkinId: string) => cached(`checkin:${checkinId}`, () => fetchCheckinDetail(checkinId));
export const loadActiveProjects = () => cached("projects:active", fetchActiveProjects);
export const loadOpenRequests = () => cached("allocations:open-requests", fetchOpenRequests);
export const loadMyExpenses = () => cached("expenses:mine", fetchMyExpenses);
export const loadScans = () => cached("receipts:scans", fetchScans);
export const loadNotifications = (unreadOnly: boolean, limit: number) =>
  cached(`notifications:${unreadOnly ? "unread" : "all"}:${limit}`, () => fetchNotifications({ unreadOnly, limit }));

// Ticket request: the lists behind the form's pickers, so it opens offline.
export const loadApprovedVendors = () => cached("vendors:approved", fetchApprovedVendors);
export const loadBomItems = (projectId: string) => cached(`bom:items:${projectId}`, () => fetchBomItems(projectId));
// Terms and Privacy text (public endpoint, so the caller supplies the request).
export const loadLegalDocs = <T,>(load: () => Promise<T>) => cached("legal:docs", load);