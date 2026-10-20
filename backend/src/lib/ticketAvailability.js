// ticketAvailability.js — is a Material Request still waiting for a purchase?
//
// A scanned receipt can sit in the app for hours. By the time it is submitted
// the request may already have been filled by another receipt, a split, or a
// synced offline expense. Same rule as lib/openRequests.js:
//   remaining = tickets.quantity - quantity of its expenses that aren't Rejected
// A request with no quantity can't be measured, so any non-Rejected expense
// counts as fulfilling it. Rejected expenses never count: the purchase didn't
// happen, so the request is open again.

const FULFILLED_MESSAGE =
  "This request has already been fulfilled by another expense. Discard this receipt or pick a different request.";

// Hundredths, so decimal quantities compare exactly.
const toHundredths = (value) => Math.round(Number(value) * 100);

// Pure: given the ticket's requested quantity and what is already charged to it.
function isFulfilled(ticketQuantity, spent) {
  const count = Number((spent && spent.count) || 0);
  if (ticketQuantity === null || ticketQuantity === undefined) return count > 0;
  return toHundredths((spent && spent.quantity) || 0) >= toHundredths(ticketQuantity);
}

// run: (sql, params) => Promise<{ rows }>, the pool's query or a transaction client's.
async function isTicketFulfilled(run, ticketID, ticketQuantity) {
  const result = await run(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(quantity), 0) AS quantity
       FROM expenses
      WHERE ticketid = $1 AND status <> 'Rejected'`,
    [ticketID]
  );
  return isFulfilled(ticketQuantity, result.rows && result.rows[0]);
}

module.exports = { isFulfilled, isTicketFulfilled, FULFILLED_MESSAGE };
