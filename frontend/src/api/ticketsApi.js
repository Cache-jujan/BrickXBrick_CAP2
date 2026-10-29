import { apiClient } from "./client";

export async function createTicket(payload) {
  const { data } = await apiClient.post("/api/tickets", payload);
  return data;
}

export async function listApprovedVendors() {
  const { data } = await apiClient.get("/api/tickets/vendors");
  return data;
}

export async function listPendingTickets() {
  const { data } = await apiClient.get("/api/tickets/pending");
  return data;
}

// GET /api/tickets/managed — the PM's tickets by status group
// ("Pending" | "Acknowledged" | "History"), optionally one project. Rows carry
// BOM context (bomUnitCost, bomQuantity, bomAlreadyRequested) for on-BOM
// Material Requests, plus submittedByName / resolvedByName.
export async function listManagedTickets(status, projectId) {
  const params = { status };
  if (projectId) params.projectId = projectId;
  const { data } = await apiClient.get("/api/tickets/managed", { params });
  return data;
}

// GET /api/tickets/expense-linkable — resolved Material Request tickets.
// The backend restricts Project Managers to their own projects.
export async function listExpenseLinkableTickets() {
  const { data } = await apiClient.get("/api/tickets/expense-linkable");
  return data;
}

// GET /api/tickets/purchasers -> [{ userid, name, email, role }]
// The active Purchasers. Pass a projectId (one the PM manages) to also get that
// project's Site Manager at the end of the list (role "Site Manager"): the PM can
// assign a Material Request to them to buy.
export async function listPurchasers(projectId) {
  const params = projectId ? { projectID: projectId } : undefined;
  const { data } = await apiClient.get("/api/tickets/purchasers", { params });
  return data;
}

// neededBy: "YYYY-MM-DD" to set the needed-by date, "" to clear it, undefined to keep it.
export async function acknowledgeTicket(ticketId, assignedTo, approvedBudget, neededBy) {
  const { data } = await apiClient.patch(`/api/tickets/${ticketId}/acknowledge`, {
    assignedTo,
    ...(approvedBudget !== undefined ? { approvedBudget } : {}),
    ...(neededBy !== undefined ? { neededBy: neededBy || null } : {}),
  });
  return data;
}

// PATCH /api/tickets/:id/resolve — PM resolves a Report ticket directly
// (Pending -> Resolved). Also used by the assigned Purchaser for other types.
export async function resolveTicket(ticketId) {
  const { data } = await apiClient.patch(`/api/tickets/${ticketId}/resolve`);
  return data;
}

// PATCH /api/tickets/:id — PM edits a pending ticket's fields before acting on
// it. Send the editable fields for the ticket's shape; an on-BOM Material
// Request's materialType/unit are locked server-side and ignored here.
export async function updateTicket(ticketId, payload) {
  const { data } = await apiClient.patch(`/api/tickets/${ticketId}`, payload);
  return data;
}

// PATCH /api/tickets/:id/reject — PM rejects a pending ticket with a reason
// (so the Site Manager knows what was wrong). Pending -> Rejected.
export async function rejectTicket(ticketId, reason) {
  const { data } = await apiClient.patch(`/api/tickets/${ticketId}/reject`, { reason });
  return data;
}