// ticketBudget.js — the strict budget rules for a Material Request (post-consultation fix).
//
//   1. A request with no approved budget cannot be bought against.
//   2. An expense can never be more than what is left of the approved budget
//      (approvedBudget minus the spend that is not Rejected). Every role, no allowance.
//   3. When an expense finishes the request and costs less than what is left, the
//      submitter must say why (the note is stored in expenses.submitnote for the PM).
//
// Pure except loadRemainingBudgetCents, which takes a query function so a route can run
// it inside its own transaction.

const { formatMoney } = require("./allocationValidation");

const SUBMIT_NOTE_MAX = 300;

const peso = (cents) => `₱${Number(formatMoney(cents)).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * @param {{ amountCents: number, remainingBudgetCents: number|null, completesRequest: boolean,
 *           note?: string|null, label?: string }} input
 * @returns {null | { code: "NO_APPROVED_BUDGET"|"OVER_BUDGET"|"UNDERSPEND_NOTE_REQUIRED", message: string }}
 */
function checkBudget({ amountCents, remainingBudgetCents, completesRequest, note, label = "This request" }) {
  if (remainingBudgetCents === null || remainingBudgetCents === undefined) {
    return {
      code: "NO_APPROVED_BUDGET",
      message: `${label} has no approved budget yet. Ask the Project Manager to set one before buying.`,
    };
  }
  if (amountCents > remainingBudgetCents) {
    return {
      code: "OVER_BUDGET",
      message: `Over budget: ${label} would cost ${peso(amountCents)} but only ${peso(remainingBudgetCents)} is left in its approved budget.`,
    };
  }
  if (completesRequest && amountCents < remainingBudgetCents && !String(note ?? "").trim()) {
    return {
      code: "UNDERSPEND_NOTE_REQUIRED",
      message: `${label} is finished with ${peso(remainingBudgetCents - amountCents)} of its budget unspent. Add a note saying why.`,
    };
  }
  return null;
}

/**
 * Budget problems for every portion of a split plan.
 * @param {{ ticketID: string, materialType: string, amountCents: number,
 *           remainingBudgetCents: number|null, resolvesTicket: boolean }[]} portions
 * @returns {{ ticketID: string, code: string, message: string }[]}
 */
function budgetIssuesFor(portions, note) {
  const issues = [];
  for (const portion of portions) {
    const issue = checkBudget({
      amountCents: portion.amountCents,
      remainingBudgetCents: portion.remainingBudgetCents,
      completesRequest: portion.resolvesTicket,
      note,
      label: portion.materialType || "This request",
    });
    if (issue) issues.push({ ticketID: portion.ticketID, ...issue });
  }
  return issues;
}

/**
 * What is left of a request's approved budget, in centavos; null when it has none.
 * Rejected expenses do not count. excludeExpenseID leaves one expense out (a resubmit
 * replaces its own earlier amount).
 * @param {(sql: string, params: any[]) => Promise<{ rowCount: number, rows: any[] }>} run
 */
async function loadRemainingBudgetCents(run, ticketID, excludeExpenseID = null) {
  const result = await run(
    `SELECT t.approvedbudget - COALESCE(
              (SELECT SUM(e.amount) FROM expenses e
                WHERE e.ticketid = t.ticketid
                  AND e.status <> 'Rejected'
                  AND ($2::uuid IS NULL OR e.expenseid <> $2::uuid)), 0) AS remaining
       FROM tickets t
      WHERE t.ticketid = $1`,
    [ticketID, excludeExpenseID]
  );
  const remaining = result.rows[0]?.remaining;
  if (remaining === null || remaining === undefined) return null;
  return Math.round(Number(remaining) * 100);
}

module.exports = { checkBudget, budgetIssuesFor, loadRemainingBudgetCents, SUBMIT_NOTE_MAX };
