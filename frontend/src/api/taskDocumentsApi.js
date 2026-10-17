import { apiClient } from "./client";

// Documents attached to a Planning-phase task. GM (any project) and the
// owning PM only; the backend enforces it.

// GET /api/tasks/:id/documents
// -> [{ documentID, taskID, fileName, contentType, sizeBytes, uploadedAt,
//       uploadedBy, uploadedByName }]
export async function listTaskDocuments(taskId) {
  const { data } = await apiClient.get(`/api/tasks/${taskId}/documents`);
  return data;
}

// POST /api/tasks/:id/documents — the form field must be named "file".
// PDF, JPEG or PNG, up to 10 MB.
export async function uploadTaskDocument(taskId, file) {
  const fd = new FormData();
  fd.append("file", file);
  const { data } = await apiClient.post(`/api/tasks/${taskId}/documents`, fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

// GET /api/tasks/:id/documents/:docId/download -> { url, fileName }.
// Ask for the url right before opening it: when the bucket is made private
// this will be a short-lived link.
export async function getTaskDocumentUrl(taskId, documentId) {
  const { data } = await apiClient.get(`/api/tasks/${taskId}/documents/${documentId}/download`);
  return data;
}

// DELETE /api/tasks/:id/documents/:docId — only while the task is still open.
export async function deleteTaskDocument(taskId, documentId) {
  await apiClient.delete(`/api/tasks/${taskId}/documents/${documentId}`);
}
