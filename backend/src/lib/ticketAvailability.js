// ticketAvailability.js — is a Material Request still waiting for a purchase?
//
// A scanned receipt can sit in the app for hours. By the time it is submitted
// the request may already have been filled by another receipt, a split, or a
// synced offline expense. Same rule as lib/openRequests.js:
//   remaining = tickets.quantity - quantity of its expenses that aren't Rejected
// A request with no quantity can't be measured, so any non-Rejected expense
// counts as fulfilling it. Rejected expenses never count: the purchase didn't
// happen, so the request is open again.
//
// A request is Resolved only when a purchase brings what is left to 0
// (completesRequest). Buying part of it leaves it Acknowledged, open for the
// rest, whoever buys (Purchaser, Site Manager, PM or GM).

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

// Pure: does recording `thisQuantity` more bring the request to 0 left?
// A request with no quantity can't be measured, so its first expense finishes it
// (the same rule isFulfilled uses).
function completesRequest(ticketQuantity, spent, thisQuantity) {
  if (ticketQuantity === null || ticketQuantity === undefined) return true;
  return (
    toHundredths((spent && spent.quantity) || 0) + toHundredths(thisQuantity || 0) >= toHundredths(ticketQuantity)
  );
}

// run: (sql, params) => Promise<{ rows }>, the pool's query or a transaction client's.
async function loadSpent(run, ticketID) {
  const result = await run(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(quantity), 0) AS quantity
       FROM expenses
      WHERE ticketid = $1 AND status <> 'Rejected'`,
    [ticketID]
  );
  return result.rows && result.rows[0];
}

async function isTicketFulfilled(run, ticketID, ticketQuantity) {
  return isFulfilled(ticketQuantity, await loadSpent(run, ticketID));
}

// Does an expense of `thisQuantity` finish the request? Run inside the transaction that holds
// the ticket row lock, so what is already charged cannot change underneath it.
async function expenseCompletesRequest(run, ticketID, ticketQuantity, thisQuantity) {
  return completesRequest(ticketQuantity, await loadSpent(run, ticketID), thisQuantity);
}

module.exports = { isFulfilled, isTicketFulfilled, completesRequest, expenseCompletesRequest, FULFILLED_MESSAGE };
