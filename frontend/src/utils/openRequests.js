// How the Open requests page arranges the open material requests (the web counterpart of the
// mobile To Buy list). Pure. Requests come from GET /api/allocations/open-requests.

const vendorKey = (name) => (name ? String(name).trim().toLowerCase() : "");

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
    started: bought > 0 || (spent ?? 0) > 0,
  };
}

const byAge = (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt);

/**
 * Groups requests under their store, named stores A to Z. Requests with no store asked for go in
 * one group with key "" that is listed last; they only show when no store is picked.
 * @returns {{ key: string, vendorName: string | null, requests: object[] }[]}
 */
export function groupByVendor(requests) {
  const groups = new Map();
  for (const request of Array.isArray(requests) ? requests : []) {
    const key = vendorKey(request.vendorName);
    if (!groups.has(key)) groups.set(key, { key, vendorName: key ? String(request.vendorName).trim() : null, requests: [] });
    groups.get(key).requests.push(request);
  }
  for (const group of groups.values()) group.requests.sort(byAge);
  return [...groups.values()].sort((a, b) => (!a.key ? 1 : !b.key ? -1 : a.key.localeCompare(b.key)));
}

/**
 * Groups requests under their project, the project with the oldest request first.
 * @returns {{ projectId: string, projectName: string, requests: object[] }[]}
 */
export function groupByProject(requests) {
  const groups = new Map();
  for (const request of Array.isArray(requests) ? requests : []) {
    if (!groups.has(request.projectID)) {
      groups.set(request.projectID, { projectId: request.projectID, projectName: request.projectName, requests: [], firstAt: Infinity });
    }
    const group = groups.get(request.projectID);
    group.requests.push(request);
    const time = Date.parse(request.createdAt);
    if (Number.isFinite(time) && time < group.firstAt) group.firstAt = time;
  }
  return [...groups.values()]
    .map((group) => ({ ...group, requests: group.requests.sort(byAge) }))
    .sort((a, b) => a.firstAt - b.firstAt || String(a.projectName).localeCompare(String(b.projectName)))
    // eslint-disable-next-line no-unused-vars
    .map(({ firstAt, ...group }) => group);
}

/** The stores to pick from: named stores A to Z. Requests with no store only show under "All stores". */
export function vendorOptions(requests) {
  return groupByVendor(requests).filter((g) => g.key).map((g) => ({ key: g.key, vendorName: g.vendorName }));
}

/** Keeps only one store's requests; null means every store. */
export function filterByVendor(requests, key) {
  const list = Array.isArray(requests) ? requests : [];
  return key === null || key === undefined ? list : list.filter((r) => vendorKey(r.vendorName) === key);
}

/** Keeps only one project's requests; null means every project. */
export function filterByProject(requests, projectId) {
  const list = Array.isArray(requests) ? requests : [];
  return projectId ? list.filter((r) => r.projectID === projectId) : list;
}
