import { apiClient } from "./client";

// opts: { unreadOnly, before, limit } — before/limit drive the /notifications
// page's "load more" (keyset paging on createdAt); the Topbar dropdown just
// calls this with no opts for its first page.
export async function listMyNotifications(opts) {
  const { unreadOnly, before, limit } = opts || {};
  const params = {};
  if (unreadOnly) params.unreadOnly = "true";
  if (before) params.before = before;
  if (limit) params.limit = limit;
  const { data } = await apiClient.get("/api/notifications/mine", {
    params: Object.keys(params).length ? params : undefined,
  });
  return data;
}

export async function getUnreadCount() {
  const { data } = await apiClient.get("/api/notifications/unread-count");
  return data.count;
}

export async function markNotificationRead(id) {
  const { data } = await apiClient.patch(`/api/notifications/${id}/read`);
  return data;
}

export async function markAllNotificationsRead() {
  const { data } = await apiClient.patch("/api/notifications/read-all");
  return data;
}