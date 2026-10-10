import { apiClient } from "./client";

export async function verifyExpense(expenseId) {
  const { data } = await apiClient.get(`/api/blockchain/verify/${expenseId}`);
  return data;
}

// status: "open" (default; the sidebar badge uses it), "reviewed" or "all"
export async function listTamperAlerts(status = "open") {
  const { data } = await apiClient.get("/api/blockchain/alerts", { params: { status } });
  return data;
}

export async function getProjectBlockchainSummary(projectId) {
  const { data } = await apiClient.get(`/api/blockchain/project/${projectId}`);
  return data;
}

// note: required explanation (10+ characters). The alert stays on record.
export async function resolveTamperAlert(alertId, note) {
  const { data } = await apiClient.patch(`/api/blockchain/alerts/${alertId}/resolve`, { note });
  return data;
}

export async function getBlockchainSummary() {
  const { data } = await apiClient.get("/api/blockchain/summary");
  return data;
}