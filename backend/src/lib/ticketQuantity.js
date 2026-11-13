// ticketQuantity.js — how much of a requested material a receipt holds.
//
// A receipt can list other materials and fee lines (delivery, VAT) next to the requested
// one, so the receipt's total quantity is not the quantity bought for the request. These
// helpers add up only the lines that belong to the request. Pure: no database.

// Case- and spacing-insensitive text for comparing names ("CEMENT " = "cement").
function normalize(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

// How much of the requested material the receipt holds: the quantity of only the lines that
// belong to this request (same rules as the material check in fraudScreening). null when no
// line can be tied to it, or a matched line has no quantity, so the caller falls back to the
// receipt's total quantity.
//   ticket: { materialtype, bomitemid }   (lower-case column names, as the routes read them)
function quantityOfMatchedLines(items, ticket, ticketId) {
  const requestedName = normalize(ticket.materialtype);
  let found = false;
  let sum = 0;
  for (const item of items || []) {
    if (!item) continue;
    const description = normalize(item.description);
    const matches = ticket.bomitemid
      ? item.bomItemID === ticket.bomitemid
        || (item.matchedTicketID != null && String(item.matchedTicketID) === String(ticketId))
        || (!item.bomItemID && description === requestedName)
      : requestedName !== "" && description.includes(requestedName);
    if (!matches) continue;
    const qty = item.quantity == null || item.quantity === "" ? NaN : Number(item.quantity);
    if (!Number.isFinite(qty)) return null;
    found = true;
    sum += qty;
  }
  return found ? sum : null;
}

module.exports = { normalize, quantityOfMatchedLines };
