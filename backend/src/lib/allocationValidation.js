// allocationValidation.js — request validation for F8 split receipts.
// Amounts are converted to integer centavos before summing so the allocation
// check never depends on floating-point equality.

const VALID_CATEGORIES = ["Materials", "Equipment", "Other"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AMOUNT_CENTS = 999_999_999_999;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

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

function formatMoney(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateAllocationBody(body = {}) {
  const { receiptImageURL, vendorName, receiptDate, category, portions } = body;

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
  if (!Array.isArray(portions) || portions.length < 2) {
    throw httpError(400, "portions must contain at least two project allocations");
  }

  const receiptTotalCents = parseMoneyCents(body.receiptTotal, "receiptTotal");
  const seenProjects = new Set();
  let allocatedCents = 0;
  const normalizedPortions = portions.map((portion, index) => {
    if (!portion || typeof portion !== "object" || Array.isArray(portion)) {
      throw httpError(400, `portions[${index}] must be an object`);
    }
    if (portion.projectID && portion.projectId && portion.projectID !== portion.projectId) {
      throw httpError(400, `portions[${index}] contains conflicting projectID and projectId values`);
    }
    const projectID = portion.projectID || portion.projectId;
    if (typeof projectID !== "string" || !UUID_PATTERN.test(projectID)) {
      throw httpError(400, `portions[${index}].projectID must be a valid UUID`);
    }
    const normalizedProjectID = projectID.toLowerCase();
    if (seenProjects.has(normalizedProjectID)) {
      throw httpError(400, "each project may appear only once in portions");
    }
    seenProjects.add(normalizedProjectID);

    const amountCents = parseMoneyCents(portion.amount, `portions[${index}].amount`);
    allocatedCents += amountCents;
    if (!Number.isSafeInteger(allocatedCents)) {
      throw httpError(400, "sum of portions exceeds the supported amount");
    }
    return { projectID: normalizedProjectID, amount: portion.amount, amountCents };
  });

  if (allocatedCents !== receiptTotalCents) {
    const mismatchCents = Math.abs(allocatedCents - receiptTotalCents);
    throw httpError(
      400,
      `Portions total ${formatMoney(allocatedCents)} must equal receiptTotal ${formatMoney(receiptTotalCents)}; mismatch ${formatMoney(mismatchCents)}`
    );
  }

  return {
    receiptImageURL: receiptImageURL.trim(),
    vendorName: vendorName.trim(),
    receiptDate,
    category,
    receiptTotal: body.receiptTotal,
    receiptTotalCents,
    tin: typeof body.tin === "string" && body.tin.trim() ? body.tin.trim() : null,
    birPermitNumber: typeof body.birPermitNumber === "string" && body.birPermitNumber.trim() ? body.birPermitNumber.trim() : null,
    birNumber: typeof body.birNumber === "string" && body.birNumber.trim() ? body.birNumber.trim() : null,
    portions: normalizedPortions,
  };
}

module.exports = { validateAllocationBody, parseMoneyCents, formatMoney, UUID_PATTERN };
