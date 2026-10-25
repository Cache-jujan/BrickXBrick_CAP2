// How the To Buy tab arranges the Purchaser's open requests. Pure, so it is tested
// in Node (lib/sync/test/to-buy.test.mjs).
//
// Each request carries the vendor the Site Manager asked for, so grouping by vendor
// gives the Purchaser a shopping route: one stop per store, everything to buy there.

/** How far along one request is. Quantity and money are each 0 to 1, or null when unknown. */
export function progressOf(request) {
  const requested = Number(request.requestedQuantity);
  const remaining = Number(request.remainingQuantity);
  const bought = Number.isFinite(requested) && Number.isFinite(remaining) ? Math.max(0, requested - remaining) : 0;

  const budget = request.approvedBudget == null ? null : Number(request.approvedBudget);
  const budgetLeft = request.remainingBudget == null ? null : Number(request.remainingBudget);
  const spent = budget != null && budgetLeft != null ? Math.max(0, budget - budgetLeft) : null;

  return {
    bought,
    requested: Number.isFinite(requested) ? requested : 0,
    quantityShare: requested > 0 ? Math.min(1, bought / requested) : null,
    spent,
    budget,
    // Nothing bought yet: the Purchaser has not started this request.
    started: bought > 0 || (spent ?? 0) > 0,
  };
}

const vendorKey = (name) => (name ? name.trim().toLowerCase() : "");

/**
 * @param {{ ticketID: string, vendorName: string | null, createdAt: string }[]} requests
 * @returns {{ key: string, vendorName: string | null, requests: typeof requests }[]}
 *   named stores A to Z, then requests with no store ("Any store") last; oldest request first within a store
 */
export function groupByVendor(requests) {
  const groups = new Map();
  for (const request of Array.isArray(requests) ? requests : []) {
    const key = vendorKey(request.vendorName);
    if (!groups.has(key)) groups.set(key, { key, vendorName: key ? request.vendorName.trim() : null, requests: [] });
    groups.get(key).requests.push(request);
  }

  for (const group of groups.values()) {
    group.requests.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  return [...groups.values()].sort((a, b) => {
    if (!a.key) return 1;
    if (!b.key) return -1;
    return a.key.localeCompare(b.key);
  });
}

/** Assigned tickets the To Buy list cannot show with progress (no material or quantity), so they get their own section. */
export function otherRequests(assignedTickets, openRequests) {
  const covered = new Set((Array.isArray(openRequests) ? openRequests : []).map((r) => r.ticketID));
  return (Array.isArray(assignedTickets) ? assignedTickets : []).filter(
    (ticket) => ticket.status === "Acknowledged" && ticket.tickettype === "Material Request" && !covered.has(ticket.ticketid)
  );
}

/** Keeps only the requests of one store; null means every store. "" is the requests with no store. */
export function filterByVendor(requests, key) {
  const list = Array.isArray(requests) ? requests : [];
  return key === null || key === undefined ? list : list.filter((r) => vendorKey(r.vendorName) === key);
}

/**
 * The stores to pick from: named stores A to Z. Requests with no store asked for are not an option
 * of their own; they only show under "All stores".
 * @returns {{ key: string, vendorName: string }[]}
 */
export function vendorOptions(requests) {
  return groupByVendor(requests)
    .filter((g) => g.key)
    .map((g) => ({ key: g.key, vendorName: g.vendorName }));
}
