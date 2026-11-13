// How much of a request a receipt buys, for the "bought X of Y" bar on the Submit expense page.
// Mirrors the server's rule (backend/src/lib/ticketQuantity.js + ticketAvailability.js), which has
// the last word: a request is Resolved only by the purchase that brings what is left to 0.

const hundredths = (value) => Math.round(Number(value) * 100);
const normalize = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Quantity of only the receipt lines for the request; null when none match or a matched line has
 * no quantity (the caller then uses the receipt total). Same rule as the server's
 * quantityOfMatchedLines: a BOM-linked request takes lines with its BOM link, a line matched to it,
 * or an unlinked line with exactly its name; any other request takes lines containing its name.
 * ticket: { ticketID, materialType, bomItemID }
 */
export function matchedQuantity(lines, ticket) {
  const requestedName = normalize(ticket?.materialType);
  let found = false;
  let sum = 0;
  for (const line of lines ?? []) {
    if (!line) continue;
    const description = normalize(line.description);
    const matches = ticket?.bomItemID
      ? line.bomItemID === ticket.bomItemID
        || (line.matchedTicketID != null && String(line.matchedTicketID) === String(ticket.ticketID))
        || (!line.bomItemID && description === requestedName)
      : requestedName !== "" && description.includes(requestedName);
    if (!matches) continue;
    const raw = line.quantity;
    const qty = raw === "" || raw == null ? NaN : Number(raw);
    if (!Number.isFinite(qty)) return null;
    found = true;
    sum += qty;
  }
  return found ? sum : null;
}

/** Total quantity on every line (the receipt total); a line with no quantity counts as 1. */
export function receiptTotalQuantity(lines) {
  return (lines ?? []).reduce((sum, line) => {
    const qty = line?.quantity === "" || line?.quantity == null ? NaN : Number(line.quantity);
    return sum + (Number.isFinite(qty) ? qty : 1);
  }, 0);
}

/** Where the request stands once this receipt is in; null when its quantities are not known (no bar). */
export function receiptProgress({ requested, remaining, thisQuantity }) {
  if (!Number.isFinite(Number(requested)) || !Number.isFinite(Number(remaining)) || Number(requested) <= 0) return null;
  const total = hundredths(requested);
  const left = hundredths(remaining);
  const adds = hundredths(thisQuantity || 0);
  const before = Math.max(0, total - left);
  return {
    requested: Number(requested),
    boughtBefore: before / 100,
    thisQuantity: adds / 100,
    leftAfter: Math.max(0, left - adds) / 100,
    completes: adds >= left,
    over: adds > left,
    boughtShare: Math.min(1, before / total),
    afterShare: Math.min(1, (before + adds) / total),
  };
}
