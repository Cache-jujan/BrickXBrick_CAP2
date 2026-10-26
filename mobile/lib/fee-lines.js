// Receipt lines that are charges rather than goods (VAT, delivery, freight, a discount).
// They carry no quantity, so the review screen sets theirs to 0 instead of asking.
// Pure, so it is tested in Node (lib/sync/test/fee-lines.test.mjs).

const FEE_WORDS = /\b(vat|value[- ]added|tax(?!-free)|delivery|freight|shipping|handling|service (?:fee|charge)|discount|rounding|adjustment|surcharge|tip)\b/i;

export function isFeeLine(description) {
  return typeof description === "string" && FEE_WORDS.test(description);
}

/** The quantity text to start a line with: what OCR read, else 0 for a fee line, else blank (the Purchaser fills it). */
export function defaultQuantity(description, ocrQuantity) {
  if (ocrQuantity != null && String(ocrQuantity).trim() !== "") return String(ocrQuantity);
  return isFeeLine(description) ? "0" : "";
}
