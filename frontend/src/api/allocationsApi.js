import { apiClient } from "./client";

// F8 split receipt. All three routes allow Purchaser, Project Manager and
// General Manager; the server scopes the open requests to the caller.

// GET /api/allocations/open-requests — the "To buy" list, oldest first.
export async function listOpenRequests() {
  const { data } = await apiClient.get("/api/allocations/open-requests");
  return data;
}

// POST /api/allocations/preview — the split the server WOULD save. Writes nothing.
// lineItems: [{ description, quantity, amount }]
// options:   { excludeTicketIDs: [], feeTargets: { [lineIndex]: ticketID } }
export async function previewAllocation(lineItems, options = {}) {
  const { data } = await apiClient.post("/api/allocations/preview", {
    lineItems,
    excludeTicketIDs: options.excludeTicketIDs || [],
    feeTargets: options.feeTargets || {},
  });
  return data;
}

// POST /api/allocations — save the split (one expense per request, one transaction).
export async function submitAllocation(payload) {
  const { data } = await apiClient.post("/api/allocations", payload);
  return data;
}
