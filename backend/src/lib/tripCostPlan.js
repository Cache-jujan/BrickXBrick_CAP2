// tripCostPlan.js — splits a petty cash expense (snacks, gas for delivery,
// allowance, other) across projects. The code and URL still say "trip cost", the
// feature's first name; people now see it as "Petty cash".
//
// A petty cash expense has no request to match, so the person ticks the projects it
// served and the receipt is split evenly in whole centavos. Pure, so it is
// tested without a database (test/tripCostPlan.test.js).

// What the app offers now.
const PETTY_CASH_REASONS = ["Snacks", "Gas", "Allowance", "Other"];
// Toll and Delivery were offered before petty cash; they are still accepted so an
// older app version can keep submitting. New screens do not show them.
const REASONS = [...PETTY_CASH_REASONS, "Toll", "Delivery"];
// The note saying what the money was for is required and kept to this length.
const NOTE_MAX = 300;

/**
 * @param {number} totalCents  receipt total in centavos (a positive integer)
 * @param {string[]} projectIDs  distinct project ids, in the order the leftover centavos are handed out
 * @returns {{ projectID: string, amountCents: number }[]}  amounts add up to totalCents exactly
 */
function splitTripCost(totalCents, projectIDs) {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new Error("totalCents must be a positive whole number");
  }
  const ids = [...new Set(projectIDs)];
  if (ids.length === 0) throw new Error("Pick at least one project");

  const share = Math.floor(totalCents / ids.length);
  const leftover = totalCents - share * ids.length; // fewer centavos than projects
  return ids.map((projectID, index) => ({ projectID, amountCents: share + (index < leftover ? 1 : 0) }));
}

module.exports = { REASONS, PETTY_CASH_REASONS, NOTE_MAX, splitTripCost };
