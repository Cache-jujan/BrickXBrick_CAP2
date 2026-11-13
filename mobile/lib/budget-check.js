// The strict budget, checked on the phone BEFORE the request is resolved, so a refused
// amount never leaves the request half-finished. The server checks again (and wins):
// backend/src/lib/ticketBudget.js. Pure, so it is tested in Node
// (lib/sync/test/budget-check.test.mjs).

const cents = (value) => Math.round(Number(value) * 100);

/**
 * What is left of a request's approved budget, as a peso string; undefined when the
 * request has no approved budget (or it is not on hand).
 * @param {{ approvedbudget?: string|number|null, expensetotal?: string|number|null }} ticket
 */
export function remainingBudgetText(ticket) {
  if (!ticket || ticket.approvedbudget == null || ticket.approvedbudget === "") return undefined;
  const left = cents(ticket.approvedbudget) - cents(ticket.expensetotal ?? 0);
  return (left / 100).toFixed(2);
}

/**
 * @param {{ amount: number, remaining?: string|number|null, note?: string|null, completes?: boolean }} input
 *   completes = this purchase brings the request to 0 left (default true when the quantity is not known).
 * @returns {null | { code: "none"|"over"|"note", remaining: number|null }}
 *   none = no approved budget, over = amount above what is left,
 *   note = finishes the request with money to spare and no reason written. A part purchase needs no note.
 */
export function budgetIssue({ amount, remaining, note, completes = true }) {
  if (remaining === undefined || remaining === null || remaining === "") return { code: "none", remaining: null };
  const left = cents(remaining);
  const spend = cents(amount);
  if (spend > left) return { code: "over", remaining: left / 100 };
  if (spend < left && completes && !String(note ?? "").trim()) return { code: "note", remaining: left / 100 };
  return null;
}
