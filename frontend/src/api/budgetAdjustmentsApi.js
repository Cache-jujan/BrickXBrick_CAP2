import { apiClient } from "./client";

// A Purchaser's "please adjust the budget" ticket (ticketType "Budget Adjustment"). Only the Project Manager of
// the project decides it: approving raises the request's approved budget by the amount asked for.

/** Approve: the request's approved budget goes up. */
export async function approveBudgetAdjustment(ticketId) {
  const { data } = await apiClient.post(`/api/budget-adjustments/${ticketId}/approve`);
  return data;
}

/** Reject, with a reason the Purchaser can read. */
export async function rejectBudgetAdjustment(ticketId, reason) {
  const { data } = await apiClient.post(`/api/budget-adjustments/${ticketId}/reject`, { reason });
  return data;
}
