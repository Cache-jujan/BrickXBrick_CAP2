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

// POST /api/projects — General Manager only. Creates a Draft project.
// payload: { name, description, clientName, budget, projectType,
//            municipality, province, siteAddress,
//            startDate (target date of development),
//            constructionStartDate (target date of construction),
//            endDate (target date of completion),
//            projectManagerId, siteManagerId }
// The response carries `warnings` (e.g. OUTSIDE_SERVICE_AREA).
export async function createProject(payload) {
  const { data } = await apiClient.post("/api/projects", payload);
  return data;
}

// GET /api/projects/eligible-managers — every active Project Manager with
// { openProjects, openProjectCount, maxOpenProjects, available } (GM only).
// Pass projectId when editing so that project doesn't count against its PM.
export async function getEligibleManagers(projectId) {
  const { data } = await apiClient.get("/api/projects/eligible-managers", {
    params: projectId ? { projectId } : undefined,
  });
  return data;
}

// GET /api/projects/eligible-site-managers — same shape, Site Managers (GM/PM)
export async function getEligibleSiteManagers(projectId) {
  const { data } = await apiClient.get("/api/projects/eligible-site-managers", {
    params: projectId ? { projectId } : undefined,
  });
  return data;
}

// GET /api/projects/options — project types, service area and limits (GM)
export async function getProjectOptions() {
  const { data } = await apiClient.get("/api/projects/options");
  return data;
}

// PATCH /api/projects/:id — GM edits details (any subset of the create fields)
export async function updateProject(projectId, payload) {
  const { data } = await apiClient.patch(`/api/projects/${projectId}`, payload);
  return data;
}

// Status changes (GM only)
export async function activateProject(projectId) {
  const { data } = await apiClient.patch(`/api/projects/${projectId}/activate`);
  return data;
}

export async function cancelProject(projectId, reason) {
  const { data } = await apiClient.patch(`/api/projects/${projectId}/cancel`, { reason });
  return data;
}

export async function completeProject(projectId, actualCompletionDate) {
  const { data } = await apiClient.patch(`/api/projects/${projectId}/complete`, { actualCompletionDate });
  return data;
}

export async function updateProjectSiteManager(projectId, siteManagerId) {
  const { data } = await apiClient.patch(`/api/projects/${projectId}/site-manager`, {
    siteManagerId: siteManagerId || null,
  });
  return data;
}
