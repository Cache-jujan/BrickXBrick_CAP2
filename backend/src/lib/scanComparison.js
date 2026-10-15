// scanComparison.js — F9 Layer 5. Compares a submitted expense with what the
// server's own OCR read from the same receipt image (ReceiptScans.result).
//
// Why: the review screen lets the submitter correct every field, which is
// needed because OCR is not always right. But the same freedom lets a line
// that says "Heavy duty plug" be renamed to the requested material, and the
// receipt text was lost once it was overwritten. The scan result is saved on
// the server, so the server, not the phone, decides what changed.
//
// Edits are allowed. Each one is listed in a Receipt_Edited flag so the PM
// sees "receipt read X, submitted Y" next to the photo before approving.
//
// Pure: no database. screenExpense.js loads the rows and writes the flag.

const { normalizeBirFields } = require("./receiptFields");
const { words } = require("./materialMatch");

const MAX_REASON = 1500;

// Same marker as screenExpense's Layer 4: adjustment lines have their own flag.
const ADJUSTMENT_LINE = /^adjustment\b/i;

function toCents(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function peso(cents) {
  const [whole, frac] = (Math.abs(cents) / 100).toFixed(2).split(".");
  return `${cents < 0 ? "-" : ""}₱${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

function sameText(a, b) {
  const clean = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return clean(a) === clean(b);
}

// pg returns a DATE as a Date at local midnight; the scan holds "YYYY-MM-DD".
// Reading local parts gives the calendar day in both cases.
function dayOf(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function levenshtein(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * Do two line descriptions name the same thing? True for the same words in
 * any order, for most words shared ("Portland cement 40kg" / "Portland
 * cement"), and for a typo fix ("Portlnd cement" / "Portland cement").
 * False for a different item ("Heavy duty plug" / "Cement").
 */
function sameItem(a, b) {
  const wa = words(a);
  const wb = words(b);
  if (wa.length === 0 || wb.length === 0) return false;
  const setB = new Set(wb);
  const shared = new Set(wa.filter((w) => setB.has(w))).size;
  const dice = (2 * shared) / (new Set(wa).size + setB.size);
  if (dice >= 0.5) return true;
  const ja = wa.join(" ");
  const jb = wb.join(" ");
  return levenshtein(ja, jb) <= Math.floor(Math.max(ja.length, jb.length) * 0.25);
}

function parseLines(lineItems) {
  let items = lineItems;
  if (typeof items === "string") {
    try { items = JSON.parse(items); } catch { return []; }
  }
  return Array.isArray(items) ? items.filter((item) => item && typeof item.description === "string") : [];
}

/**
 * Was the receipt actually read by the OCR? A scan that failed (or never
 * happened) means every value was typed by the submitter.
 *   scan: { status, result } from ReceiptScans, or null when none exists
 * Returns a reason string for a Manual_Entry flag, or null.
 */
function manualEntryReason(scan) {
  if (!scan) {
    return "No scan of this receipt was found on the server, so every value was typed in by the submitter.";
  }
  if (scan.status !== "Ready" || !scan.result || scan.result.ocrError) {
    return "The scan could not read this receipt, so every value was typed in by the submitter. Check them against the photo.";
  }
  return null;
}

/**
 * List what the submitter changed compared with the scan.
 *   expense       the expenses row (lowercase keys, as SELECT * returns it)
 *   draft         ReceiptScans.result for the same image
 *   receiptAmount the receipt total that was submitted. For a split receipt
 *                 this is the sum over all its portions, not this portion.
 *   split         true for one portion of a split receipt: its lines carry
 *                 only part of a receipt line, so line amounts aren't compared
 * Returns { changes: string[], reason: string | null }.
 */
function compareWithScan({ expense, draft, receiptAmount, split = false }) {
  const changes = [];

  // Header fields. A value typed into a field the scan left blank is listed
  // too: it is how a receipt with no TIN becomes Formal (F7).
  const field = (label, scanned, submitted, same) => {
    const hasScan = scanned !== null && scanned !== undefined && scanned !== "";
    const hasSubmitted = submitted !== null && submitted !== undefined && submitted !== "";
    if (!hasSubmitted) return; // clearing a field only loses information
    if (!hasScan) changes.push(`${label} "${submitted}" was typed in; the scan read none`);
    else if (!same(scanned, submitted)) changes.push(`${label} changed from "${scanned}" to "${submitted}"`);
  };

  field("Vendor", draft.vendorName, expense.vendorname, sameText);

  const scannedBir = normalizeBirFields(draft);
  const submittedBir = normalizeBirFields({ tin: expense.tin, birPermitNumber: expense.birpermitnumber, birNumber: expense.birnumber });
  const equal = (a, b) => a === b;
  field("TIN", scannedBir.tin, submittedBir.tin, equal);
  field("BIR permit", scannedBir.birPermitNumber, submittedBir.birPermitNumber, equal);
  field("OR/SI number", scannedBir.birNumber, submittedBir.birNumber, equal);

  const scannedTotal = toCents(draft.amount);
  const submittedTotal = toCents(receiptAmount);
  if (submittedTotal !== null) {
    if (scannedTotal === null) changes.push(`Total ${peso(submittedTotal)} was typed in; the scan read none`);
    else if (scannedTotal !== submittedTotal) changes.push(`Total changed from ${peso(scannedTotal)} to ${peso(submittedTotal)}`);
  }

  // A date the scan didn't read is not listed: the phone fills in today, and
  // the date doesn't decide money or BIR status.
  const scannedDay = dayOf(draft.receiptDate);
  const submittedDay = dayOf(expense.receiptdate);
  if (scannedDay && submittedDay && scannedDay !== submittedDay) {
    changes.push(`Receipt date changed from ${scannedDay} to ${submittedDay}`);
  }

  // Lines. Every submitted line must be one the scan read. Removing a line
  // is not listed: a split portion carries only some of the receipt's lines.
  const scannedLines = parseLines(draft.lineItems);
  let unmatched = 0;
  for (const line of parseLines(expense.lineitems)) {
    if (ADJUSTMENT_LINE.test(line.description.trim())) continue;
    const match = scannedLines.find((scanned) => sameItem(scanned.description, line.description));
    if (!match) {
      unmatched += 1;
      changes.push(`Line "${line.description}" is not on the scanned receipt`);
      continue;
    }
    const scannedCents = toCents(match.amount);
    const submittedCents = toCents(line.amount);
    if (!split && scannedCents !== null && submittedCents !== null && scannedCents !== submittedCents) {
      changes.push(`Line "${line.description}" amount changed from ${peso(scannedCents)} to ${peso(submittedCents)}`);
    }
  }
  if (unmatched > 0) {
    const read = scannedLines.map((line) => `"${line.description}"`).join(", ");
    changes.push(read ? `The scan read these lines: ${read}` : "The scan read no lines");
  }

  if (changes.length === 0) return { changes, reason: null };
  let reason = `Changed after scanning: ${changes.join("; ")}.`;
  if (reason.length > MAX_REASON) reason = `${reason.slice(0, MAX_REASON - 1)}…`;
  return { changes, reason };
}

module.exports = { compareWithScan, manualEntryReason, sameItem, dayOf };
