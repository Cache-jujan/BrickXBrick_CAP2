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
// extra = { escalationRate (0–0.10), escalationNote } (adviser item 6), optional.
export async function saveBom(projectId, sections, extra = {}) {
  const { data } = await apiClient.put(`/api/projects/${projectId}/bom`, { sections, ...extra });
  return data;
}

// GM. Records the client's agreement and locks the BOM; the project budget
// becomes the BOM total. agreement = { clientAgreedOn: "YYYY-MM-DD",
// clientAgreedBy, agreementRef? } (adviser item 5: the client agrees outside
// the system; this records when and with whom).
// A 409 with code CONFIRM_WARNINGS means the warnings must be confirmed.
export async function approveBom(projectId, confirmWarnings = false, agreement = {}) {
  const { data } = await apiClient.patch(`/api/projects/${projectId}/bom/approve`, { confirmWarnings, ...agreement });
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

// GM, PM, assigned SM or Purchaser. Approved BOM items for the Material Request
// picker. Unit costs are included only for GM/PM. Returns { status, items }.
export async function getBomItems(projectId, search) {
  const q = search ? `?search=${encodeURIComponent(search)}` : "";
  const { data } = await apiClient.get(`/api/projects/${projectId}/bom/items${q}`);
  return data;
}