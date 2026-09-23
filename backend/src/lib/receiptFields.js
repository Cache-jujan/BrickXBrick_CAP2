// receiptFields.js — the single translation point between parser.js output
// and the `expenses` table, plus the canonical aliased column list.
//
// Why this file exists:
//   1. Postgres folded all schema identifiers to lowercase (created
//      unquoted). Aliasing on the way OUT keeps the API camelCase without a
//      migration. Select EXPENSE_COLUMNS rather than `*` so the response
//      shape can't drift between routes.
//   2. parser.js emits storeName / orSiNumber / date; the table has
//      vendorname / birnumber / receiptdate. Mapping here means /scan hands
//      the client a payload it can post straight back to /expenses.

// Use as: `SELECT ${EXPENSE_COLUMNS} FROM expenses WHERE ...`
// and as: `... RETURNING ${EXPENSE_COLUMNS}`  (never RETURNING *)
const EXPENSE_COLUMNS = `
  expenseid            AS "expenseID",
  projectid            AS "projectID",
  submittedby          AS "submittedBy",
  approvedby           AS "approvedBy",
  ticketid             AS "ticketID",
  vendorname           AS "vendorName",
  amount,
  receiptdate          AS "receiptDate",
  category,
  birvalidationstatus  AS "birValidationStatus",
  receiptimageurl      AS "receiptImageURL",
  status,
  submittedat          AS "submittedAt",
  birnumber            AS "birNumber",
  quantity,
  tin,
  birpermitnumber      AS "birPermitNumber",
  lineitems            AS "lineItems",
  blockchainstatus     AS "blockchainStatus"
`;

// numeric(12,2) comes back from pg as a STRING, and that is correct — JS
// floats can't hold pesos exactly. Leave amounts as strings end-to-end;
// use integer centavos if you ever need arithmetic (F11).

/**
 * Drop line items the expenses validator would reject, rather than handing
 * the client a draft that 400s on submit. normalizeAmount() returns null on
 * a value it couldn't read, and the four-column regex can match a row whose
 * description is junk — both get filtered out here. Anything dropped is
 * re-added by the user through the existing "+ Add item" flow.
 */
function normalizeLineItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];

  return rawItems
    .filter(
      (item) =>
        item &&
        typeof item.description === "string" &&
        item.description.trim().length > 0 &&
        typeof item.amount === "number" &&
        Number.isFinite(item.amount) &&
        item.amount >= 0
    )
    .map((item) => ({
      description: item.description.trim(),
      amount: item.amount,
      quantity: Number.isFinite(item.quantity) ? item.quantity : null,
      unitPrice: Number.isFinite(item.unitPrice) ? item.unitPrice : null,
    }));
}

/**
 * Convert parseReceiptText() output into a draft matching the /expenses
 * POST body field-for-field.
 *
 * Deliberately does not invent values OCR can't know: projectID, ticketID,
 * and category stay absent, and quantity is only filled when the parser
 * actually matched line items.
 */
function toExpenseDraft(parsed) {
  const amount = parsed.amount === null ? null : Number(parsed.amount);
  const lineItems = normalizeLineItems(parsed.lineItems);

  const quantity = lineItems.length
    ? lineItems.reduce((sum, i) => sum + (i.quantity || 0), 0)
    : null;

  return {
    vendorName: parsed.storeName,
    receiptDate: parsed.date,
    amount: Number.isFinite(amount) ? amount : null,
    tin: parsed.tin,
    birPermitNumber: parsed.birPermitNumber,
    birNumber: parsed.orSiNumber, // <- the name bridge
    lineItems,
    quantity: quantity || null,
  };
}

/**
 * F7 classification. Presence check on the three BIR-required fields; it
 * does NOT verify a TIN is real.
 *
 * This runs server-side on submit, not just on scan — birValidationStatus
 * decides what lands in the BIR tax-deductible report (F11), so a client
 * must not be able to declare its own receipt Formal.
 */
function classifyBir({ tin, birPermitNumber, birNumber }) {
  const missing = [];
  if (!tin) missing.push("tin");
  if (!birPermitNumber) missing.push("birPermitNumber");
  if (!birNumber) missing.push("birNumber");

  return {
    birValidationStatus: missing.length === 0 ? "Formal-Tax-Deductible" : "Informal",
    missingBirFields: missing,
  };
}

/**
 * Same trust model as classifyBir: quantity is derived server-side from
 * confirmed line items, never accepted as a raw client number. Each item's
 * own quantity defaults to 1 when unset (matches the review screen's seed).
 */
function computeQuantityFromLineItems(lineItems) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return null;
  return lineItems.reduce((sum, item) => sum + (Number.isFinite(item.quantity) ? item.quantity : 1), 0);
}

module.exports = { EXPENSE_COLUMNS, toExpenseDraft, classifyBir, normalizeLineItems, computeQuantityFromLineItems };