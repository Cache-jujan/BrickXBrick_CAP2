import { apiClient } from "./client";

// GET /api/projects — broadcast to all four roles; optional status filter.
export async function listProjects(status) {
  const { data } = await apiClient.get("/api/projects", {
    params: status ? { status } : undefined,
  });
  return data;
}

// GET /api/projects/:id — GM (any project) or PM (owning project only).
// A non-owning PM gets a 403 here — see assertProjectAccess in projects.js.
export async function getProject(id) {
  const { data } = await apiClient.get(`/api/projects/${id}`);
  return data;
}

// GET /api/projects/:id/overview — same access rule as getProject, but
// returns { ...project, progress, milestones: [{ ...milestone, tasks: [] }] }
// in one call instead of project + N milestone calls + N task calls.
export async function getProjectOverview(id) {
  const { data } = await apiClient.get(`/api/projects/${id}/overview`);
  return data;
}

// POST /api/projects — General Manager only
// payload: { name, description, clientName, budget, startDate, endDate, projectManagerId, siteManagerId }
export async function createProject(payload) {
  const { data } = await apiClient.post("/api/projects", payload);
  return data;
}

// GET /api/projects/eligible-managers — Active Project Managers only, for
// the Create Project PM dropdown (GM only)
export async function getEligibleManagers() {
  const { data } = await apiClient.get("/api/projects/eligible-managers");
  return data;
}