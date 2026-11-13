import { apiClient } from "./client";

// GET /api/admin/users
export async function listUsers() {
  const { data } = await apiClient.get("/api/admin/users");
  return data;
}

// POST /api/admin/users — payload: { name, email, role }; an invitation email is sent
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

// POST /api/admin/users/:id/send-password-email
// "Enforce change password upon login": the user gets an email link and sets
// their own password. The System Administrator never types or sees one.
// Returns { userID, status: "password_email_sent", channel: "invite" | "recovery" }.
export async function sendPasswordEmail(id) {
  const { data } = await apiClient.post(`/api/admin/users/${id}/send-password-email`);
  return data;
}

// Vendor Master List: GET/POST /api/admin/vendors, PATCH/DELETE /api/admin/vendors/:id
// payload: { vendorName, location?, tin?, birPermitType?, birPermitNumber? }
export async function listVendors() {
  const { data } = await apiClient.get("/api/admin/vendors");
  return data;
}

export async function createVendor(payload) {
  const { data } = await apiClient.post("/api/admin/vendors", payload);
  return data;
}

export async function updateVendor(id, payload) {
  const { data } = await apiClient.patch(`/api/admin/vendors/${id}`, payload);
  return data;
}

export async function deleteVendor(id) {
  const { data } = await apiClient.delete(`/api/admin/vendors/${id}`);
  return data;
}

export const PERMIT_TYPES = ["Permit", "PTU", "ATP"];

export const VALID_ROLES = [
  "General Manager",
  "Project Manager",
  "Site Manager",
  "Purchaser",
  "System Administrator",
];

// GET /api/admin/users/overview — counts for the top of the admin page
export async function getAdminOverview() {
  const { data } = await apiClient.get("/api/admin/users/overview");
  return data;
}
