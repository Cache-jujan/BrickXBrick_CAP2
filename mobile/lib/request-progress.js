// How much of a request a receipt buys, for the "bought X of Y" bar on the check-receipt screen.
// Mirrors the server's rule (backend/src/lib/ticketQuantity.js + ticketAvailability.js), which has
// the last word: a request is Resolved only by the purchase that brings what is left to 0.
// Pure, so it is tested in Node (lib/sync/test/request-progress.test.mjs).

const hundredths = (value) => Math.round(Number(value) * 100);
const normalize = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Quantity of only the receipt lines that belong to the request (other materials and fee lines
 * are left out). null when no line can be tied to it, or a matched line has no quantity: the
 * caller then uses the receipt total, as the server does.
 * @param {{ description?: string, quantity?: number|null, bomItemID?: string|null, matchedTicketID?: string|null }[] | undefined} lines
 * @param {{ ticketId: string, materialType?: string|null, bomItemID?: string|null }} ticket
 */
export function matchedQuantity(lines, ticket) {
  const requestedName = normalize(ticket.materialType);
  let found = false;
  let sum = 0;
  for (const line of lines ?? []) {
    if (!line) continue;
    const description = normalize(line.description);
    const matches = ticket.bomItemID
      ? line.bomItemID === ticket.bomItemID
        || (line.matchedTicketID != null && String(line.matchedTicketID) === String(ticket.ticketId))
        || (!line.bomItemID && description === requestedName)
      : requestedName !== "" && description.includes(requestedName);
    if (!matches) continue;
    const qty = line.quantity == null ? NaN : Number(line.quantity);
    if (!Number.isFinite(qty)) return null;
    found = true;
    sum += qty;
  }
  return found ? sum : null;
}

/** Total quantity on every line (the receipt total), counting a line with no quantity as 1. */
export function receiptTotalQuantity(lines) {
  return (lines ?? []).reduce((sum, line) => sum + (Number.isFinite(Number(line?.quantity)) && line?.quantity != null ? Number(line.quantity) : 1), 0);
}

/**
 * Where the request stands once this receipt is in.
 * @param {{ requested?: number, remaining?: number, thisQuantity: number }} input
 * @returns {null | { requested: number, boughtBefore: number, thisQuantity: number, leftAfter: number,
 *   completes: boolean, over: boolean, boughtShare: number, afterShare: number }}
 *   null when the request's quantities are not known (no bar is shown).
 */
export function receiptProgress({ requested, remaining, thisQuantity }) {
  if (!Number.isFinite(Number(requested)) || !Number.isFinite(Number(remaining)) || Number(requested) <= 0) return null;
  const total = hundredths(requested);
  const left = hundredths(remaining);
  const adds = hundredths(thisQuantity || 0);
  const before = Math.max(0, total - left);
  const leftAfter = Math.max(0, left - adds);
  return {
    requested: Number(requested),
    boughtBefore: before / 100,
    thisQuantity: adds / 100,
    leftAfter: leftAfter / 100,
    completes: adds >= left,
    over: adds > left,
    boughtShare: Math.min(1, before / total),
    afterShare: Math.min(1, (before + adds) / total),
  };
}

/** The quantity fields of a SelectedTicket, from an open request (To Buy list). */
export function quantityFieldsFromRequest(request) {
  return {
    materialType: request.materialType ?? null,
    bomItemID: request.bomItemID ?? null,
    requestedQuantity: request.requestedQuantity ?? undefined,
    remainingQuantity: request.remainingQuantity ?? undefined,
    unit: request.unit ?? null,
  };
}

/** The quantity fields of a SelectedTicket, from a ticket row (assigned / submitted lists). */
export function quantityFieldsFromTicket(ticket) {
  const requested = ticket.quantity == null ? NaN : Number(ticket.quantity);
  const bought = Number(ticket.expensequantity ?? 0);
  if (!Number.isFinite(requested)) return { materialType: ticket.materialtype ?? null, unit: ticket.unit ?? null };
  return {
    materialType: ticket.materialtype ?? null,
    bomItemID: ticket.bomitemid ?? null,
    requestedQuantity: requested,
    remainingQuantity: requested - (Number.isFinite(bought) ? bought : 0),
    unit: ticket.unit ?? null,
  };
}
