import { apiClient } from "./client";

export async function listMyNotifications(unreadOnly) {
  const { data } = await apiClient.get("/api/notifications/mine", {
    params: unreadOnly ? { unreadOnly: "true" } : undefined,
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