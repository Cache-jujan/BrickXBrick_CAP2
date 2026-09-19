import { apiClient } from "./client";

// POST /api/milestones/:id/tasks — Project Manager only, must own the
// milestone's project, AND the project must already have a Site Manager
// assigned (backend 400s otherwise — see milestones.js). The task is
// auto-assigned to that Site Manager; there's no assignee field to send.
//
// Note: this only ever creates a task at status='Pending', 0%. Moving a
// task to 'Completed' happens exclusively through the F5 flow
// (POST /api/tasks/:id/progress from the Site Manager's mobile app, then
// PATCH /api/tasks/progress-log/:logId/review from a PM) — not part of
// this module.
export async function createTask(milestoneId, payload) {
  const { data } = await apiClient.post(`/api/milestones/${milestoneId}/tasks`, payload);
  return data;
}
