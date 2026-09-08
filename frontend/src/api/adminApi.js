import { apiClient } from "./client";

// GET /api/admin/users
export async function listUsers() {
  const { data } = await apiClient.get("/api/admin/users");
  return data;
}

// POST /api/admin/users
// payload: { name, email, role, tempPassword? }
export async function createUser(payload) {
  const { data } = await apiClient.post("/api/admin/users", payload);
  return data;
}

// PATCH /api/admin/users/:id — payload: { role?, status? }
export async function updateUser(id, payload) {
  const { data } = await apiClient.patch(`/api/admin/users/${id}`, payload);
  return data;
}

// POST /api/admin/users/:id/deactivate
export async function deactivateUser(id) {
  const { data } = await apiClient.post(`/api/admin/users/${id}/deactivate`);
  return data;
}

// POST /api/admin/users/:id/unlock
export async function unlockUser(id) {
  const { data } = await apiClient.post(`/api/admin/users/${id}/unlock`);
  return data;
}

export const VALID_ROLES = [
  "General Manager",
  "Project Manager",
  "Site Manager",
  "Purchaser",
  "System Administrator",
];
