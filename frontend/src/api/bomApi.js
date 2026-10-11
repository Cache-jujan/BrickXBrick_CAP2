import { apiClient } from "./client";

// F2 Bill of Materials — /api/projects/:projectId/bom (see backend/src/routes/bom.js)

// GM or the owning PM. { projectId, projectStatus, projectBudget, bom: null | {...} }
export async function getBom(projectId) {
  const { data } = await apiClient.get(`/api/projects/${projectId}/bom`);
  return data;
}

// GM. Uploads the company BOM (.xlsx) and replaces the Draft.
// Returns the same shape as getBom plus importReport { skippedRows, rowWarnings }.
export async function importBom(projectId, file) {
  const fd = new FormData();
  fd.append("file", file);
  const { data } = await apiClient.post(`/api/projects/${projectId}/bom/import`, fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

// GM. Saves the edited Draft (or starts one by hand).
// sections: [{ sectionId?, name, subheading, laborMode, laborRate, laborAmount,
//              items: [{ bomItemId?, description, quantity, unit, unitCost }] }]
export async function saveBom(projectId, sections) {
  const { data } = await apiClient.put(`/api/projects/${projectId}/bom`, { sections });
  return data;
}

// GM. Locks the BOM; the project budget becomes the BOM total.
// A 409 with code CONFIRM_WARNINGS means the warnings must be confirmed.
export async function approveBom(projectId, confirmWarnings = false) {
  const { data } = await apiClient.patch(`/api/projects/${projectId}/bom/approve`, { confirmWarnings });
  return data;
}

// GM. Back to Draft with a reason (the PM is notified).
export async function reopenBom(projectId, reason) {
  const { data } = await apiClient.patch(`/api/projects/${projectId}/bom/reopen`, { reason });
  return data;
}

// GM. Removes a Draft BOM of a Draft project.
export async function deleteBom(projectId) {
  await apiClient.delete(`/api/projects/${projectId}/bom`);
}
