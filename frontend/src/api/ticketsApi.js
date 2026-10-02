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

// GET /api/tickets/expense-linkable — resolved Material Request tickets.
// The backend restricts Project Managers to their own projects.
export async function listExpenseLinkableTickets() {
  const { data } = await apiClient.get("/api/tickets/expense-linkable");
  return data;
}

export async function listPurchasers() {
  const { data } = await apiClient.get("/api/tickets/purchasers");
  return data;
}

export async function acknowledgeTicket(ticketId, assignedTo, approvedBudget) {
  const { data } = await apiClient.patch(`/api/tickets/${ticketId}/acknowledge`, {
    assignedTo,
    ...(approvedBudget !== undefined ? { approvedBudget } : {}),
  });
  return data;
}
