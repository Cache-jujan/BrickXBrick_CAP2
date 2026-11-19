import { apiClient } from "./client";

// F8 split receipt. The split routes allow Purchaser, Project Manager and
// General Manager (and Site Manager); the server scopes the open requests to the caller.

/** Fetch the caller's open material requests, ordered oldest first. */
export async function listOpenRequests() {
  const { data } = await apiClient.get("/api/allocations/open-requests");
  return data;
}

/**
 * Preview a receipt split without saving expenses.
 * @param {Array<{description: string, quantity: number, amount: number}>} lineItems Receipt lines.
 * @param {{excludeTicketIDs?: string[], feeTargets?: Object<string, string>, lineTargets?: Object<string, string>, quantityTargets?: Object<string, number>}} [options]
 *   Requests to exclude, fee destinations by line index, lines matched to a request by hand (line index to ticket id),
 *   and typed quantities ("lineIndex:ticketID" to quantity): a line with any typed quantity is split exactly so.
 * @returns {Promise<object>} The server's allocation plan and validation results.
 */
export async function previewAllocation(lineItems, options = {}) {
  const { data } = await apiClient.post("/api/allocations/preview", {
    lineItems,
    excludeTicketIDs: options.excludeTicketIDs || [],
    feeTargets: options.feeTargets || {},
    lineTargets: options.lineTargets || {},
    quantityTargets: options.quantityTargets || {},
  });
  return data;
}

/** Submit receipt details and allocation options to save one expense per request in one transaction. */
export async function submitAllocation(payload) {
  const { data } = await apiClient.post("/api/allocations", payload);
  return data;
}
