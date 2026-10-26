// Groups rows by project for the Purchaser's screens (To Buy by project, the allocation
// preview, the trip-cost checklist). Pure, so it is tested in Node
// (lib/sync/test/project-groups.test.mjs).

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => { id: string, name: string, amount?: number | null, at?: string | null }} pick
 *   what project an item belongs to, how much it is worth, and when it was created
 * @returns {{ projectId: string, projectName: string, items: T[], count: number, total: number }[]}
 *   oldest project first (by its oldest item), so the order matches the oldest-first split
 */
export function groupByProject(items, pick) {
  const groups = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const { id, name, amount, at } = pick(item);
    if (!groups.has(id)) groups.set(id, { projectId: id, projectName: name, items: [], count: 0, total: 0, firstAt: Infinity });
    const group = groups.get(id);
    group.items.push(item);
    group.count += 1;
    group.total += Number.isFinite(Number(amount)) ? Number(amount) : 0;
    const time = Date.parse(at ?? "");
    if (Number.isFinite(time) && time < group.firstAt) group.firstAt = time;
  }

  return [...groups.values()]
    .sort((a, b) => a.firstAt - b.firstAt || a.projectName.localeCompare(b.projectName))
    .map(({ firstAt, ...group }) => group);
}

/**
 * Tick state of a project row from how many of its items are ticked.
 * @returns {"all" | "some" | "none"}
 */
export function tickState(ticked, total) {
  if (total <= 0 || ticked <= 0) return "none";
  return ticked >= total ? "all" : "some";
}

/** Keeps only the requests of one project; null means every project. */
export function filterByProject(requests, projectId) {
  const list = Array.isArray(requests) ? requests : [];
  return projectId ? list.filter((r) => r.projectID === projectId) : list;
}

/**
 * Ticket ids to leave out of a scan that was started for certain projects.
 * No projects (null or empty) means the scan is not scoped, so nothing is left out.
 */
export function outOfScopeTicketIDs(openRequests, projectIds) {
  if (!Array.isArray(projectIds) || projectIds.length === 0) return [];
  const wanted = new Set(projectIds);
  return (Array.isArray(openRequests) ? openRequests : []).filter((r) => !wanted.has(r.projectID)).map((r) => r.ticketID);
}
