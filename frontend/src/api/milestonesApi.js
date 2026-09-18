import { apiClient } from "./client";

// POST /api/milestones — Project Manager only, must own the project.
// payload: { projectID, name, dueDate }  (note: projectID, capital ID,
// matches the backend's req.body destructure in milestones.js)
export async function createMilestone(payload) {
  const { data } = await apiClient.post("/api/milestones", payload);
  return data;
}

// GET /api/milestones?projectId= — list milestones for a project.
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
