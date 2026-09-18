import { apiClient } from "./client";

// POST /api/milestones/:id/tasks — Project Manager only, must own the
// milestone's project. Auto-assigned to the project's Site Manager on
// the backend (schema is 1 SM per project) — no assignee field here.
// payload: { taskName, dueDate }
export async function createTask(milestoneId, payload) {
  const { data } = await apiClient.post(`/api/milestones/${milestoneId}/tasks`, payload);
  return data;
}
