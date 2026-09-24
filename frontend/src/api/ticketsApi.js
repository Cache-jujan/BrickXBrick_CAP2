import { apiClient } from "./client";

export async function createTicket(payload) {
  const { data } = await apiClient.post("/api/tickets", payload);
  return data;
}
