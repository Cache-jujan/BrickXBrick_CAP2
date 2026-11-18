import { apiClient } from "./client";

// The server only issues the next sequential Purchase Order number ("PO-2026-014").
// The PO page itself is built in the browser from the open requests the page already has.
// Allowed for Purchaser, Site Manager, Project Manager and General Manager.

/** Get the next PO number. */
export async function getPoNumber() {
  const { data } = await apiClient.post("/api/purchase-orders/number");
  return data.poNumber;
}
