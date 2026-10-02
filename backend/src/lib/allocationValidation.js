// allocationValidation.js — request validation for F8 split receipts.
//
// Two unit rules keep every comparison exact:
//   - money is integer centavos   (₱16,800.00 -> 1680000)
//   - quantity is integer hundredths (60 bags -> 6000, 2.5 cu.m -> 250)
// JavaScript floats can't hold most peso amounts exactly (0.1 + 0.2 !== 0.3),
// so we never add or compare floats.

const VALID_CATEGORIES = ["Materials", "Equipment", "Other"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AMOUNT_CENTS = 999_999_999_999; // DECIMAL(12,2)
const MAX_LINES = 200;

function httpError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

// Peso number -> integer centavos. Rejects negatives, NaN, and fractional centavos.
function parseMoneyCents(value, fieldName) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw httpError(400, `${fieldName} must be a finite, non-negative number`);
  }

  // String conversion rejects fractional centavos and values outside the
  // DECIMAL(12,2) storage range instead of silently rounding them.
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) {
    throw httpError(400, `${fieldName} must have at most two decimal places and fit DECIMAL(12,2)`);
  }

  const cents = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0") || 0);
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT_CENTS) {
    throw httpError(400, `${fieldName} exceeds the maximum supported amount`);
  }
  return cents;
}

// Quantity number -> integer hundredths. Same idea as parseMoneyCents, sized
// for expenses.quantity DECIMAL(10,2) (at most 8 digits before the point).
function parseQuantityH(value, fieldName) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw httpError(400, `${fieldName} must be a finite, non-negative number`);
  }
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) {
    throw httpError(400, `${fieldName} must have at most two decimal places and fit DECIMAL(10,2)`);
  }
  return Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0") || 0);
}

function formatMoney(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function optionalText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Manuscript UTC-003 / UTC-004.
// allocations: [{ amount }] in pesos. receiptTotal: pesos.
// Returns { valid: true } or { valid: false, error }. Never throws.
function validateAllocationSum(allocations, receiptTotal) {
  try {
    if (!Array.isArray(allocations) || allocations.length === 0) {
      return { valid: false, error: "Allocation sum does not match receipt total" };
    }
    const totalCents = parseMoneyCents(receiptTotal, "receiptTotal");
    let sumCents = 0;
    allocations.forEach((allocation, index) => {
      sumCents += parseMoneyCents(allocation && allocation.amount, `allocations[${index}].amount`);
    });
    if (sumCents !== totalCents) {
      return { valid: false, error: "Allocation sum does not match receipt total" };
    }
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

// Receipt lines -> validated lines with integer units.
// Every line needs a quantity (rule 6). 0 means a fee, VAT or delivery line.
function parseAllocationLines(lineItems) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw httpError(400, "lineItems must include at least one line");
  }
  if (lineItems.length > MAX_LINES) {
    throw httpError(400, `lineItems may contain at most ${MAX_LINES} lines`);
  }

  return lineItems.map((line, index) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      throw httpError(400, `lineItems[${index}] must be an object`);
    }
    if (typeof line.description !== "string" || !line.description.trim()) {
      throw httpError(400, `lineItems[${index}].description is required`);
    }
    if (line.quantity === undefined || line.quantity === null) {
      throw httpError(400, `lineItems[${index}].quantity is required (use 0 for delivery, VAT and fees)`);
    }
    const quantityH = parseQuantityH(line.quantity, `lineItems[${index}].quantity`);
    const amountCents = parseMoneyCents(line.amount, `lineItems[${index}].amount`);
    return {
      lineIndex: index,
      description: line.description.trim(),
      quantity: line.quantity,
      amount: line.amount,
      quantityH,
      amountCents,
    };
  });
}

// excludeTicketIDs: optional array of ticket UUIDs the actor marked
// "Not for this request". Lowercased and de-duplicated.
function parseExcludeTicketIDs(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw httpError(400, "excludeTicketIDs must be an array of ticket IDs");
  }
  const ids = new Set();
  value.forEach((id, index) => {
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
      throw httpError(400, `excludeTicketIDs[${index}] must be a valid UUID`);
    }
    ids.add(id.toLowerCase());
  });
  return [...ids];
}

// feeTargets: optional { "<lineIndex>": "<ticketID>" } that moves a
// quantity-0 line to a specific request's portion.
function parseFeeTargets(value, lines) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw httpError(400, "feeTargets must be an object of { lineIndex: ticketID }");
  }
  const targets = {};
  for (const [key, ticketID] of Object.entries(value)) {
    if (!/^\d+$/.test(key) || Number(key) >= lines.length) {
      throw httpError(400, `feeTargets key ${key} is not a valid line index`);
    }
    if (lines[Number(key)].quantityH !== 0) {
      throw httpError(400, `feeTargets can only move quantity-0 lines (line ${key} has a quantity)`);
    }
    if (typeof ticketID !== "string" || !UUID_PATTERN.test(ticketID)) {
      throw httpError(400, `feeTargets[${key}] must be a valid ticket UUID`);
    }
    targets[Number(key)] = ticketID.toLowerCase();
  }
  return targets;
}

// Body for POST /api/allocations/preview — only what the split needs.
function validatePlanInput(body = {}) {
  const lines = parseAllocationLines(body.lineItems);
  return {
    lineItems: lines,
    excludeTicketIDs: parseExcludeTicketIDs(body.excludeTicketIDs),
    feeTargets: parseFeeTargets(body.feeTargets, lines),
  };
}

// Body for POST /api/allocations — the plan input plus the receipt fields.
// Does NOT check that lines add up to receiptTotal; the route does that with
// validateAllocationSum so UTC-003/004 test the same function the route uses.
function validateAllocationBody(body = {}) {
  const { receiptImageURL, vendorName, receiptDate, category } = body;

  if (typeof receiptImageURL !== "string" || !receiptImageURL.trim()) {
    throw httpError(400, "receiptImageURL is required");
  }
  if (typeof vendorName !== "string" || !vendorName.trim()) {
    throw httpError(400, "vendorName is required");
  }
  if (!isCalendarDate(receiptDate)) {
    throw httpError(400, "receiptDate must be a valid YYYY-MM-DD date");
  }
  if (!VALID_CATEGORIES.includes(category)) {
    throw httpError(400, `category must be one of: ${VALID_CATEGORIES.join(", ")}`);
  }

  const receiptTotalCents = parseMoneyCents(body.receiptTotal, "receiptTotal");
  const plan = validatePlanInput(body);

  return {
    receiptImageURL: receiptImageURL.trim(),
    vendorName: vendorName.trim(),
    receiptDate,
    category,
    receiptTotal: body.receiptTotal,
    receiptTotalCents,
    tin: optionalText(body.tin),
    birPermitNumber: optionalText(body.birPermitNumber),
    birNumber: optionalText(body.birNumber),
    ...plan,
  };
}

module.exports = {
  VALID_CATEGORIES,
  UUID_PATTERN,
  httpError,
  parseMoneyCents,
  parseQuantityH,
  formatMoney,
  validateAllocationSum,
  parseAllocationLines,
  validatePlanInput,
  validateAllocationBody,
};
