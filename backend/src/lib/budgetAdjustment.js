// budgetAdjustment.js: the rules for a Purchaser's "please adjust the budget" ticket.
// Pure (no database), so it is tested in Node (test/budgetAdjustment.test.js).
//
// The Purchaser taps a reason instead of typing one; the code is stored and the words are built here, in
// English, because the Project Manager reads them. A note is optional, except for "Other".

const { parseMoneyCents, formatMoney } = require("./allocationValidation");

const NOTE_MAX = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The reasons the Purchaser can pick. Keep in step with the buttons in the mobile app. */
const REASONS = {
  supplier_price_increase: "The supplier raised the price",
  more_quantity: "More quantity is needed than planned",
  extra_materials: "Extra materials are needed",
  delivery_fees: "Delivery or other fees",
  estimate_too_low: "The original budget was too low",
  other: "Other reason",
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * @param {any} body { ticketID, requestedAmount, reasonCode, note? }
 * @returns {{ ticketID: string, requestedCents: number, reasonCode: string, note: string }}
 */
function validateAdjustmentBody(body) {
  const ticketID = typeof body?.ticketID === "string" ? body.ticketID : "";
  if (!UUID_RE.test(ticketID)) throw httpError(400, "ticketID must be a valid request id");

  const requestedCents = parseMoneyCents(body?.requestedAmount, "requestedAmount");
  if (requestedCents <= 0) throw httpError(400, "requestedAmount must be more than zero");

  const reasonCode = typeof body?.reasonCode === "string" ? body.reasonCode : "";
  if (!Object.prototype.hasOwnProperty.call(REASONS, reasonCode)) throw httpError(400, "Pick a reason from the list");

  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (note.length > NOTE_MAX) throw httpError(400, `The note must be ${NOTE_MAX} characters or fewer`);
  if (reasonCode === "other" && note.length === 0) throw httpError(400, "Say what the reason is");

  return { ticketID, requestedCents, reasonCode, note };
}

const peso = (cents) => `₱${Number(formatMoney(cents)).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What the PM reads on the ticket. */
function describeAdjustment({ materialType, projectName, requestedCents, currentBudgetCents, reasonCode, note }) {
  const lines = [
    `Budget adjustment requested for ${materialType || "a material request"}${projectName ? ` (${projectName})` : ""}.`,
    `Current approved budget: ${peso(currentBudgetCents)}`,
    `Extra amount needed: ${peso(requestedCents)}`,
    `New budget if approved: ${peso(currentBudgetCents + requestedCents)}`,
    `Reason: ${REASONS[reasonCode]}`,
  ];
  if (note) lines.push(`Note: ${note}`);
  return lines.join("\n");
}

/** A rejection needs a reason the Purchaser can read. */
function validateRejectionReason(reason) {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text.length === 0) throw httpError(400, "Give a reason for rejecting");
  if (text.length > NOTE_MAX) throw httpError(400, `The reason must be ${NOTE_MAX} characters or fewer`);
  return text;
}

module.exports = { REASONS, NOTE_MAX, UUID_RE, peso, validateAdjustmentBody, describeAdjustment, validateRejectionReason };
