// parser.js
//
// Converts raw Google Vision OCR text into a structured receipt object.
// Rewritten against 5 real photographed Philippine receipts (hardware
// store invoices, delivery receipts, sales invoices) instead of a clean
// synthetic example. Real receipts are messy — OCR misreads characters,
// columns get scrambled, and formats vary wildly between printers. This
// parser is written to fail *visibly* (low confidence) rather than
// *silently* (wrong value or null with no signal).
//
// Output shape is intentionally close to the original so the frontend
// (OcrResult type) doesn't need a rewrite — it just gains a few new
// fields: birPermitNumber, lineItems, and a `confidence` map.

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

const MONTHS = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", sept: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12",
};

// Turns "6", "26", "2026" into a 4-digit year. Assumes 20xx for 2-digit
// years since these are all recent business receipts, not archival ones.
function normalizeYear(y) {
  if (y.length === 4) return y;
  const n = parseInt(y, 10);
  return String(2000 + n);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

// Handles both "9,987.00" (comma thousands, dot decimal) and "11.700"
// (OCR/typist wrote a thousands separator as a dot with 3 trailing
// digits, meaning eleven thousand seven hundred, not eleven-point-seven).
// Rule: if the digits after the LAST separator number exactly 2, treat
// that separator as a decimal point. Otherwise every separator in the
// string is a thousands separator and the number is a whole peso amount.
function normalizeAmount(raw) {
  if (!raw) return null;
  const s = raw.replace(/[^\d.,]/g, "");
  if (!s) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const lastSep = Math.max(lastComma, lastDot);

  if (lastSep === -1) {
    const n = parseFloat(s);
    return Number.isNaN(n) ? null : n;
  }

  const decimalDigits = s.length - lastSep - 1;

  if (decimalDigits === 2) {
    const intPart = s.slice(0, lastSep).replace(/[.,]/g, "");
    const fracPart = s.slice(lastSep + 1);
    const n = parseFloat(`${intPart}.${fracPart}`);
    return Number.isNaN(n) ? null : n;
  }

  // 0, 1, or 3+ trailing digits after the last separator: not a decimal
  // point, so strip every separator and read the whole thing as pesos.
  const n = parseFloat(s.replace(/[.,]/g, ""));
  return Number.isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------
// Vendor name
// ---------------------------------------------------------------------
// storeName = lines[0] breaks on real photos: stray labels, tags, or
// misread characters often land above the actual business name. Instead,
// score the first several lines and pick the best business-name-shaped
// candidate.

const BOILERPLATE = [
  /sales\s*invoice/i,
  /delivery\s*receipt/i,
  /official\s*receipt/i,
  /cash\s*(sales\s*)?invoice/i,
  /charge\s*invoice/i,
  /^receipt$/i,
  /accreditation/i,
  /authority to print/i,
];

function looksLikeBoilerplate(line) {
  return BOILERPLATE.some((re) => re.test(line));
}

function extractVendorName(lines) {
  const candidates = lines.slice(0, 8).filter((l) => l.length >= 3);
  let best = null;
  let bestScore = -Infinity;

  for (const line of candidates) {
    if (looksLikeBoilerplate(line)) continue;
    if (/^\d+$/.test(line)) continue; // pure numbers, e.g. stray page numbers

    const letters = (line.match(/[A-Za-z]/g) || []).length;
    const digits = (line.match(/[0-9]/g) || []).length;
    if (letters === 0) continue;

    const commas = (line.match(/,/g) || []).length;
    let score = letters - digits * 2 - commas * 15; // addresses are comma-heavy; business names rarely are
    if (line === line.toUpperCase() && letters >= 4) score += 5; // business names are often all-caps
    if (/enterprises|hardware|supply|trading|corp|inc\.?|store|construction/i.test(line)) score += 8;
    if (/poblacion|barangay|brgy|street|st\.|avenue|ave\.|city|philippines/i.test(line)) score -= 15; // address-shaped line
    if (line.length < 4) score -= 5;

    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  }

  return best;
}

// ---------------------------------------------------------------------
// Date
// ---------------------------------------------------------------------
// Real samples included: "8/25/26", "6-5-26", "6-3-25", "07/15/2026",
// "JULY 24, 2026" — the old regex (\d{2}/\d{2}/\d{4}) only caught one
// of these five. Philippine business forms here consistently read as
// MM-DD-YY(YY).

// Receipts commonly carry a second, unrelated date — "Date Issued:" on a
// printer's BIR accreditation/ATP stamp, e.g. "Date Issued: June 7, 2021"
// — which is years off from the actual transaction date. Any match whose
// preceding ~15 characters mention "issued" is deprioritized rather than
// dropped entirely (kept only as a last-resort fallback).
function hasIssuedContext(text, matchIndex) {
  const before = text.slice(Math.max(0, matchIndex - 20), matchIndex);
  return /issued/i.test(before);
}

function extractDate(text) {
  const monthNamePattern =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\s*\.?\s*(\d{1,2}),?\s*(\d{2,4})/gi;
  const dayFirstPattern =
    /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{2,4})/gi;
  const numericPattern = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/g;

  const candidates = [];

  for (const m of text.matchAll(monthNamePattern)) {
    const month = MONTHS[m[1].toLowerCase()];
    if (!month) continue;
    candidates.push({
      value: `${normalizeYear(m[3])}-${month}-${pad2(m[2])}`,
      issued: hasIssuedContext(text, m.index),
    });
  }
  for (const m of text.matchAll(dayFirstPattern)) {
    const month = MONTHS[m[2].toLowerCase()];
    if (!month) continue;
    candidates.push({
      value: `${normalizeYear(m[3])}-${month}-${pad2(m[1])}`,
      issued: hasIssuedContext(text, m.index),
    });
  }
  for (const m of text.matchAll(numericPattern)) {
    candidates.push({
      value: `${normalizeYear(m[3])}-${pad2(m[1])}-${pad2(m[2])}`,
      issued: hasIssuedContext(text, m.index),
    });
  }

  if (candidates.length === 0) return null;
  const preferred = candidates.find((c) => !c.issued);
  return (preferred || candidates[0]).value;
}

// ---------------------------------------------------------------------
// Amount
// ---------------------------------------------------------------------
// Prioritize the most specific label first ("TOTAL AMOUNT DUE" beats a
// bare "TOTAL", which can appear multiple times for subtotals/VAT
// breakdowns on a formal sales invoice).

// A "bare label" line: something like "Cash", "Received By:", or
// "CUSTOMER'S SIGNATURE" — text with no digits at all. These commonly sit
// between a TOTAL label and an unrelated later number (an OR serial, a
// year, a permit number), so hitting one signals "give up on this label,
// the real value probably isn't near here" rather than "keep scanning
// past it."
const MONEY_LINE = /[\d][\d,\.]*\d|^\d$/;

function extractAmount(lines) {
  const labelPriority = [
    /total\s*amount\s*due/i,
    /grand\s*total/i,
    /total\s*amount/i,
    /amount\s*due/i,
    /\btotal\b/i,
  ];

  for (const labelRe of labelPriority) {
    for (let i = 0; i < lines.length; i++) {
      if (!labelRe.test(lines[i])) continue;

      // Same line as the label (e.g. "TOTAL AMOUNT   11,700")
      const sameLine = lines[i].match(MONEY_LINE);
      if (sameLine) {
        const amount = normalizeAmount(sameLine[0]);
        if (amount !== null && amount > 0) return amount;
      }

      // Otherwise scan a few following lines for a money value. Skip past
      // plain descriptive lines ("Received the above in good order..."),
      // but give up once we hit another all-caps label-looking line with
      // no digits (e.g. "CASHIER", "SIGNATURE") — that's a stronger sign
      // we've drifted into an unrelated section.
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const line = lines[j];
        if (!/\d/.test(line)) {
          if (line === line.toUpperCase() && /[A-Za-z]/.test(line)) break;
          continue;
        }
        const m = line.match(MONEY_LINE);
        if (m) {
          const amount = normalizeAmount(m[0]);
          if (amount !== null && amount > 0) return amount;
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------
// TIN
// ---------------------------------------------------------------------
// Philippine TIN: XXX-XXX-XXX, optionally with a 4-5 digit branch code.
// Receipts often contain more than one TIN (the customer's own VAT REG
// TIN vs. the printer's TIN at the bottom) — prefer one near a "TIN"
// label over a bare match found anywhere in the text.

function extractTIN(text) {
  const tinPattern = /\d{3}[-\s]\d{3}[-\s]\d{3}(?:[-\s]\d{4,5})?/g;
  const labeled = text.match(/tin\.?\s*(?:no\.?|reg\.?)?\s*:?\s*(\d{3}[-\s]\d{3}[-\s]\d{3}(?:[-\s]\d{4,5})?)/i);
  if (labeled) {
    return { value: labeled[1].replace(/\s/g, "-"), confidence: "high" };
  }

  const anyMatch = text.match(tinPattern);
  if (anyMatch) {
    return { value: anyMatch[0].replace(/\s/g, "-"), confidence: "low" };
  }

  return { value: null, confidence: "low" };
}

// ---------------------------------------------------------------------
// BIR Permit Number
// ---------------------------------------------------------------------
// Genuinely hard: receipts often carry a PRINTER'S accreditation/ATP
// number ("Accreditation No.", "Authority to Print No.") that looks
// identical in shape to a business's own BIR permit but belongs to a
// completely different entity. We actively avoid grabbing those, but
// this field should always be treated as needing manual review —
// mark it low confidence even on a "successful" match.

function extractBirPermit(text) {
  const permitPattern = /(?:bir\s*permit\s*(?:no\.?)?|permit\s*(?:to\s*use\s*)?no\.?|ptu\s*no\.?)\s*:?\s*([A-Za-z0-9\-]{4,})/i;
  const match = text.match(permitPattern);
  if (match) {
    return { value: match[1], confidence: "low" }; // always flag for human check
  }
  return { value: null, confidence: "low" };
}

// ---------------------------------------------------------------------
// OR / SI Number
// ---------------------------------------------------------------------
// None of the 5 real samples had a number immediately following an
// "OR"/"SI"/"INVOICE" label — the actual serial is usually pre-printed
// separately, e.g. "No. 1171759", "No 598127", "No 44181", "N0 096493".
// Try the explicit label first; if that fails, fall back to a bare
// "No" + digits pattern and flag it as low confidence, since that
// pattern can also match unrelated numbers (PO numbers, etc.).

function extractOrSi(text) {
  const explicit = text.match(/(?:o\.?r\.?\s*no\.?|s\.?i\.?\s*no\.?|official\s*receipt\s*no\.?|sales\s*invoice\s*no\.?|invoice\s*no\.?)\s*#?\s*:?\s*(\d{3,})/i);
  if (explicit) {
    return { value: explicit[1], confidence: "high" };
  }

  // Fallback: pre-printed serial, often OCR'd as "No", "N0", "Nº", "No."
  const fallback = text.match(/\bN[o0º°]\.?\s*(\d{4,})/);
  if (fallback) {
    return { value: fallback[1], confidence: "low" };
  }

  return { value: null, confidence: "low" };
}

// ---------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------
// This is the weakest part of OCR extraction — receipt tables get
// scrambled badly (see receipt (3), where qty/description/price/amount
// all landed as separate out-of-order lines). Rather than guess wrong,
// this only returns items it's reasonably sure about: lines that match
// "QTY  DESCRIPTION  PRICE  AMOUNT" or "QTY  DESCRIPTION  AMOUNT" laid
// out left-to-right on a single OCR line, which is what you get on
// cleaner deliveries/receipts (e.g. image 2, image 5 samples).
// Everything else is left for the user to add manually via the existing
// "+ Add item" flow in the review screen — that UI already exists and
// is the right fallback for this, not a smarter regex.

function extractLineItems(lines) {
  const items = [];
  // qty  description...  price  amount   (price/amount: digits with optional , and .)
  const fourColPattern = /^(\d{1,5})\s+([A-Za-z][A-Za-z0-9 .\/"'-]{2,40}?)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)$/;

  for (const line of lines) {
    const m = line.match(fourColPattern);
    if (!m) continue;
    const [, qty, description, price, amount] = m;
    items.push({
      description: description.trim(),
      quantity: parseInt(qty, 10),
      unitPrice: normalizeAmount(price),
      amount: normalizeAmount(amount),
      confidence: "low", // any regex-matched line item should still be eyeballed
    });
  }

  return items;
}

// ---------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------

function parseReceiptText(rawText) {
  const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);

  const vendorName = extractVendorName(lines);
  const receiptDate = extractDate(rawText);
  const totalAmount = extractAmount(lines);
  const tin = extractTIN(rawText);
  const birPermitNumber = extractBirPermit(rawText);
  const orSiNumber = extractOrSi(rawText);
  const lineItems = extractLineItems(lines);

  return {
    // Kept as top-level fields to match the existing OcrResult contract
    // (storeName/tin/orSiNumber/amount/date/items) so the frontend
    // doesn't need a breaking change tonight.
    storeName: vendorName,
    tin: tin.value,
    birPermitNumber: birPermitNumber.value,
    orSiNumber: orSiNumber.value,
    amount: totalAmount !== null ? String(totalAmount) : null,
    date: receiptDate,
    lineItems,

    // New: per-field confidence so the review UI can flag which fields
    // need a human look, per the manuscript's "low-confidence fields
    // flagged for manual correction" requirement.
    confidence: {
      vendorName: vendorName ? "medium" : "low", // heuristic, not a labeled match — never "high"
      date: receiptDate ? "medium" : "low",
      amount: totalAmount !== null ? "medium" : "low",
      tin: tin.confidence,
      birPermitNumber: birPermitNumber.confidence,
      orSiNumber: orSiNumber.confidence,
    },
  };
}

module.exports = { parseReceiptText, normalizeAmount, extractDate, extractAmount };