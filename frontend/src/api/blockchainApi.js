import { apiClient } from "./client";

export async function verifyExpense(expenseId) {
  const { data } = await apiClient.get(`/api/blockchain/verify/${expenseId}`);
  return data;
}

export async function listTamperAlerts() {
  const { data } = await apiClient.get("/api/blockchain/alerts");
  return data;
}

export async function getProjectBlockchainSummary(projectId) {
  const { data } = await apiClient.get(`/api/blockchain/project/${projectId}`);
  return data;
}