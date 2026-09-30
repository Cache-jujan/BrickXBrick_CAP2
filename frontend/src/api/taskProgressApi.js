import { apiClient } from "./client";

export async function listProgressSubmissions(status = "Pending Review") {
  const { data } = await apiClient.get("/api/tasks/progress-log", {
    params: { status },
  });
  return data;
}

export async function reviewProgressSubmission(logId, decision, reason) {
  const { data } = await apiClient.patch(`/api/tasks/progress-log/${logId}/review`, {
    decision,
    ...(reason?.trim() ? { reason: reason.trim() } : {}),
  });
  return data;
}
