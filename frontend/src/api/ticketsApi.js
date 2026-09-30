import { apiClient } from "./client";

export async function createTicket(payload) {
  const { data } = await apiClient.post("/api/tickets", payload);
  return data;
}

export async function listPendingTickets() {
  const { data } = await apiClient.get("/api/tickets/pending");
  return data;
}

// Resolved tickets available for a GM/PM expense submission. The backend
// scopes PM results to projects they manage and GM results to all projects.
export async function listExpenseTickets() {
  const { data } = await apiClient.get("/api/tickets/expense-lookup");
  return data;
}

export async function listPurchasers() {
  const { data } = await apiClient.get("/api/tickets/purchasers");
  return data;
}

export async function acknowledgeTicket(ticketId, assignedTo) {
  const { data } = await apiClient.patch(`/api/tickets/${ticketId}/acknowledge`, {
    assignedTo,
  });
  return data;
}
