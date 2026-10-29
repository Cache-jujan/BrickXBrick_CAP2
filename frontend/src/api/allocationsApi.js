import { apiClient } from "./client";

// F8 split receipt and petty cash (first called trip costs). The split routes allow Purchaser, Project Manager and
// General Manager (and Site Manager); the server scopes the open requests to the caller.

/** Fetch the caller's open material requests, ordered oldest first. */
export async function listOpenRequests() {
  const { data } = await apiClient.get("/api/allocations/open-requests");
  return data;
}

/**
 * Preview a receipt split without saving expenses.
 * @param {Array<{description: string, quantity: number, amount: number}>} lineItems Receipt lines.
 * @param {{excludeTicketIDs?: string[], feeTargets?: Object<string, string>, lineTargets?: Object<string, string>}} [options]
 *   Requests to exclude, fee destinations by line index, and lines matched to a request by hand (line index to ticket id).
 * @returns {Promise<object>} The server's allocation plan and validation results.
 */
export async function previewAllocation(lineItems, options = {}) {
  const { data } = await apiClient.post("/api/allocations/preview", {
    lineItems,
    excludeTicketIDs: options.excludeTicketIDs || [],
    feeTargets: options.feeTargets || {},
    lineTargets: options.lineTargets || {},
  });
  return data;
}

/** Submit receipt details and allocation options to save one expense per request in one transaction. */
export async function submitAllocation(payload) {
  const { data } = await apiClient.post("/api/allocations", payload);
  return data;
}

/**
 * Charge a petty cash receipt (snacks, gas for delivery, allowance, other), split evenly, to the ticked projects. No request is needed; payload.note (what it was for) is required.
 * A Project Manager can charge the Active projects they manage; a General Manager any Active project.
 * @param {{receiptImageURL: string, vendorName: string, receiptDate: string, receiptTotal: number,
 *   reason: "Gas"|"Toll"|"Delivery"|"Other", projectIds: string[], tin?: string|null,
 *   birPermitNumber?: string|null, birNumber?: string|null, note?: string, commonReceiptID?: string}} payload
 */
export async function submitTripCost(payload) {
  const { data } = await apiClient.post("/api/allocations/trip-cost", payload);
  return data;
}
