import { apiClient } from "./client";

// F8 split receipt. All three routes allow Purchaser, Project Manager and
// General Manager; the server scopes the open requests to the caller.

/** Fetch the caller's open material requests, ordered oldest first. */
export async function listOpenRequests() {
  const { data } = await apiClient.get("/api/allocations/open-requests");
  return data;
}

/**
 * Preview a receipt split without saving expenses.
 * @param {Array<{description: string, quantity: number, amount: number}>} lineItems Receipt lines.
 * @param {{excludeTicketIDs?: string[], feeTargets?: Object<string, string>}} [options] Requests to exclude and fee destinations by line index.
 * @returns {Promise<object>} The server's allocation plan and validation results.
 */
export async function previewAllocation(lineItems, options = {}) {
  const { data } = await apiClient.post("/api/allocations/preview", {
    lineItems,
    excludeTicketIDs: options.excludeTicketIDs || [],
    feeTargets: options.feeTargets || {},
  });
  return data;
}

/** Submit receipt details and allocation options to save one expense per request in one transaction. */
export async function submitAllocation(payload) {
  const { data } = await apiClient.post("/api/allocations", payload);
  return data;
}
