import { apiClient } from "./client";

// POST /api/milestones — Project Manager only, must own the project
// (backend's getOwnedProject checks project.projectmanagerid === req.user.id).
// payload: { projectID, name, dueDate }  — projectID is capitalized this
// way because that's literally what milestones.js destructures off req.body.
export async function createMilestone(payload) {
  const { data } = await apiClient.post("/api/milestones", payload);
  return data;
}

// GET /api/milestones?projectId= — no role restriction on the backend
// (requireAuth only), but the web app only ever calls this indirectly via
// getProjectOverview; kept here for completeness/future use.
export async function listMilestones(projectId) {
  const { data } = await apiClient.get("/api/milestones", {
    params: { projectId },
  });
  return data;
}

// GET /api/milestones/:id — single milestone with its tasks nested.
export async function getMilestone(id) {
  const { data } = await apiClient.get(`/api/milestones/${id}`);
  return data;
}

// GET /api/milestones/timeline/locks?projectId= — Project Manager only (owning
// PM, Draft/Active project). The project's tasks that cannot be deleted because
// they have a progress submission or attached documents.
// -> { locks: { [taskId]: "progress" | "documents" } }
export async function getTimelineLocks(projectId) {
  const { data } = await apiClient.get("/api/milestones/timeline/locks", {
    params: { projectId },
  });
  return data;
}

// PATCH /api/milestones/timeline — Project Manager only. Saves everything the
// "Edit timeline" modal changed in one all-or-nothing request.
// payload: { projectID,
//            milestones: [{ milestoneID, name?, dueDate?, remove? }],
//            tasks:      [{ taskID, taskName?, dueDate?, remove? }] }
// -> { updatedMilestones, updatedTasks, deletedMilestones, deletedTasks, warnings }
// A 409 carries details.errors: [{ type, id, message }]; nothing was saved.
export async function updateTimeline(payload) {
  const { data } = await apiClient.patch("/api/milestones/timeline", payload);
  return data;
}

// GET /api/milestones/attention — Project Manager only. The PM's At Risk /
// Overdue milestones across their open projects, each with projectName, for
// the dashboard "Needs your attention" panel.
export async function getAttentionMilestones() {
  const { data } = await apiClient.get("/api/milestones/attention");
  return data;
}