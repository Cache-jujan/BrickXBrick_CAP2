import { apiClient } from "./client";

// GET /api/projects — optional status filter, e.g. listProjects("Active")
export async function listProjects(status) {
  const { data } = await apiClient.get("/api/projects", {
    params: status ? { status } : undefined,
  });
  return data;
}

// GET /api/projects/:id
export async function getProject(id) {
  const { data } = await apiClient.get(`/api/projects/${id}`);
  return data;
}

// POST /api/projects — General Manager only
// payload: { name, description, clientName, budget, startDate, endDate }
export async function createProject(payload) {
  const { data } = await apiClient.post("/api/projects", payload);
  return data;
}
