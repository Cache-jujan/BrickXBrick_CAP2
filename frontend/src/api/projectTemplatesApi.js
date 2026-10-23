import { apiClient } from "./client";

// All of these are General Manager only. Templates are read-only: they are
// seeded by a migration and copied into a project when it is created.

// GET /api/project-templates — template cards:
// [{ templateId, name, projectType, size, description, milestoneCount, taskCount, defaultTaskCount }]
export async function listProjectTemplates() {
  const { data } = await apiClient.get("/api/project-templates");
  return data;
}

// GET /api/project-templates/:id — { kind: "template", id, name, milestones: [{ id, name, phase, tasks }] }
// Each task: { id, name, handledBy, requirementCode, defaultIncluded, selectable, hint }.
// Only `selectable` tasks (permit documents) can be unticked.
export async function getProjectTemplate(templateId) {
  const { data } = await apiClient.get(`/api/project-templates/${templateId}`);
  return data;
}

// GET /api/project-templates/copy-sources — past projects that can be copied:
// [{ projectId, name, projectType, status, clientName, municipality, milestoneCount, taskCount }]
export async function listCopySources() {
  const { data } = await apiClient.get("/api/project-templates/copy-sources");
  return data;
}

// GET /api/project-templates/copy-sources/:projectId — same shape as a template
// with kind "copy"; every task is selectable.
export async function getCopySource(projectId) {
  const { data } = await apiClient.get(`/api/project-templates/copy-sources/${projectId}`);
  return data;
}

// POST /api/project-templates/preview — the dated structure the create call
// would build. Nothing is saved.
// payload: { start, startDate, constructionStartDate, endDate }
// -> { source, milestones: [{ name, phase, dueDate, warning, tasks }],
//      omittedMilestones, needsSiteManager, counts, warnings }
export async function previewProjectStructure(payload) {
  const { data } = await apiClient.post("/api/project-templates/preview", payload);
  return data;
}
