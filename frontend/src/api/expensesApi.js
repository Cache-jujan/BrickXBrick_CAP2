import { apiClient } from "./client";

// GET /api/expenses — optional project filter, e.g. listExpenses(projectId)
export async function listExpenses(projectId) {
  const { data } = await apiClient.get("/api/expenses", {
    params: projectId ? { projectId } : undefined,
  });
  return data;
}

export async function approveExpense(id) {
  const { data } = await apiClient.patch(`/api/expenses/${id}/approve`);
  return data;
}

export async function rejectExpense(id) {
  const { data } = await apiClient.patch(`/api/expenses/${id}/reject`);
  return data;
}