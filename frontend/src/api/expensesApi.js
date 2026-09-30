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

// The backend returns 400 without a reason.
export async function rejectExpense(id, reason) {
  const { data } = await apiClient.patch(`/api/expenses/${id}/reject`, { reason });
  return data;
}

// POST /api/receipts/scan — the form field must be named "file".
export async function scanReceipt(file) {
  const fd = new FormData();
  fd.append("file", file);
  const { data } = await apiClient.post("/api/receipts/scan", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function submitExpense(payload) {
  const { data } = await apiClient.post("/api/expenses", payload);
  return data;
}

// GET /api/expenses/flagged — Pending expenses with unresolved fraud flags.
export async function listFlaggedExpenses() {
  const { data } = await apiClient.get("/api/expenses/flagged");
  return data;
}