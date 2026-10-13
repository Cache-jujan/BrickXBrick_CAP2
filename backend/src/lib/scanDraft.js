// scanDraft.js — F6 receipt OCR -> expense draft. Shared by the synchronous
// POST /receipts/scan and the background POST /receipts/scans job, so both
// return exactly the same draft.

const { query: defaultQuery } = require("./db");
const { scanReceipt } = require("./receiptOcr");
const { toExpenseDraft, classifyBir, applyVendorMaster } = require("./receiptFields");

// Cross-check: line items that don't add up to the total need a human look.
function lineItemsConfidence(draft) {
  if (!draft.lineItems.length || draft.amount === null) return "low";
  const cents = (n) => Math.round(Number(n) * 100);
  const sum = draft.lineItems.reduce((s, item) => s + cents(item.amount), 0);
  return sum === cents(draft.amount) ? "medium" : "low";
}

async function findVendorMasterRecord(vendorName, query = defaultQuery) {
  if (!vendorName) return null;

  const result = await query(
    `SELECT vendorID AS "vendorID",
            vendorName AS "vendorName",
            tin,
            birPermitType AS "birPermitType",
            birPermitNumber AS "birPermitNumber"
       FROM VendorMasterList
      WHERE approvalStatus = 'Approved'
        AND regexp_replace(lower(vendorName), '[^a-z0-9]+', '', 'g') =
            regexp_replace(lower($1), '[^a-z0-9]+', '', 'g')
      ORDER BY createdAt DESC
      LIMIT 1`,
    [vendorName]
  );

  return result.rows[0] || null;
}

/**
 * OCR one stored receipt and build the draft the review screen edits.
 * Never throws for an OCR failure: it returns an empty draft with ocrError
 * so the user can type the fields against the stored image.
 */
async function buildScanDraft(buffer, mimeType, receiptImageURL, { query = defaultQuery } = {}) {
  // Gemini reads the receipt; if every model fails the user types it in.
  // Same parsed shape as the old regex parser, so F7/F8 below don't change.
  // Images and PDFs both go through (F6.3).
  const { parsed, engine, model, ocrError } = await scanReceipt(buffer, mimeType);
  const ocrDraft = toExpenseDraft(parsed);
  const vendorMaster = await findVendorMasterRecord(ocrDraft.vendorName, query);
  // Vendor master values are the trusted vendor identity. OR/SI remains
  // receipt-specific and is never copied from the master list.
  const { draft, autoFilled, vendorConflicts } = applyVendorMaster(ocrDraft, vendorMaster);
  const { birValidationStatus, missingBirFields } = classifyBir(draft);
  const confidence = { ...parsed.confidence, lineItems: lineItemsConfidence(draft) };

  return {
    ...draft,
    receiptImageURL,
    birValidationStatus,
    missingBirFields,
    vendorMasterMatch: vendorMaster,
    autoFilled,
    vendorConflicts,
    confidence,
    ocrError,
    ocrEngine: engine,
    ocrModel: model || null,
  };
}

module.exports = { buildScanDraft, findVendorMasterRecord, lineItemsConfidence };
