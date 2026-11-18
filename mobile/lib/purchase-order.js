// The Purchase Order page itself lives in shared/purchase-order.js (the web prints the same page).
// This wraps it with the phone's own groupByProject, the one To Buy and the receipt check use.
import { groupByProject } from "./project-groups.js";
import { buildPurchaseOrder as build, renderPurchaseOrderHtml } from "../../shared/purchase-order.js";

/** @param {Parameters<typeof build>[0]} requests */
export function buildPurchaseOrder(requests) {
  return build(requests, (open) => groupByProject(open, (r) => ({ id: r.projectID, name: r.projectName, at: r.createdAt ?? null })));
}

export { renderPurchaseOrderHtml };
