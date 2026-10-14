import { apiClient } from "./client";

// POST /api/milestones/:id/tasks — Project Manager only, must own the
// milestone's project. Behavior depends on the milestone's phase:
//   Construction (default, existing behavior) — the project must already
//     have a Site Manager assigned (backend 400s otherwise — see
//     milestones.js); the task is auto-assigned to that Site Manager.
//     payload: { taskName, dueDate }
//   Planning (#5) — no Site Manager involved at all; payload must include
//     handledBy: "GM" | "PM" instead. payload: { taskName, dueDate, handledBy }
// The response includes a non-blocking `warnings` array (dateWindowWarning)
// when the due date falls outside the milestone's phase window — it's
// informational only, the task is still created.
//
// Note: a Construction task only ever starts at status='Pending', 0%.
// Moving it to 'Completed' happens through the F5 flow (POST
// /api/tasks/:id/progress from the Site Manager's mobile app, then PATCH
// /api/tasks/progress-log/:logId/review from a PM). A Planning task has no
// SM flow at all — see completeTask below.
export async function createTask(milestoneId, payload) {
  const { data } = await apiClient.post(`/api/milestones/${milestoneId}/tasks`, payload);
  return data;
}

// PATCH /api/tasks/:id/complete — Project Manager only, Planning-phase
// tasks only (backend 409s a Construction task). Marks the task Completed
// directly — no photo, no SM review — with an optional note.
// payload: { note? }
export async function completeTask(taskId, payload = {}) {
  const { data } = await apiClient.patch(`/api/tasks/${taskId}/complete`, payload);
  return data;
}