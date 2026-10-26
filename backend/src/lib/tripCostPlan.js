// tripCostPlan.js — splits a trip cost (gas, toll, delivery) across projects.
//
// A trip cost has no request to match, so the Purchaser ticks the projects the
// trip served and the receipt is split evenly in whole centavos. Pure, so it is
// tested without a database (test/tripCostPlan.test.js).

const REASONS = ["Gas", "Toll", "Delivery", "Other"];

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

module.exports = { REASONS, splitTripCost };
