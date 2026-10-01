// allocationValidation.js — hybrid F8 split-receipt validation and arithmetic.
// The client supplies the receipt total and OCR/manual source lines. Project
// amounts are derived with integer centavos, never binary floating-point sums.

const VALID_CATEGORIES = ["Materials", "Equipment", "Other"];
const VALID_ADJUSTMENT_TYPES = new Set(["tax", "discount", "fee", "rounding", "other"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AMOUNT_CENTS = 999_999_999_999; // DECIMAL(12,2)
const MAX_QUANTITY_HUNDREDTHS = 9_999_999_999; // DECIMAL(10,2)

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseMoneyCents(value, fieldName) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw httpError(400, `${fieldName} must be a finite, non-negative number`);
  }
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

function parseQuantityHundredths(value, fieldName) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw httpError(400, `${fieldName} must be a finite positive number`);
  }
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) {
    throw httpError(400, `${fieldName} must have at most two decimal places and fit DECIMAL(10,2)`);
  }
  const hundredths = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0") || 0);
  if (!Number.isSafeInteger(hundredths) || hundredths > MAX_QUANTITY_HUNDREDTHS) {
    throw httpError(400, `${fieldName} exceeds the maximum supported quantity`);
  }
  return hundredths;
}

function formatMoneyCents(cents) {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function formatQuantityHundredths(hundredths) {
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
}

/** Split integer cents among integer weights using largest remainder. */
function distributeCents(totalCents, weights) {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0 || !Array.isArray(weights) || weights.length === 0) {
    throw new TypeError("distributeCents expects a non-negative safe integer and a non-empty weights array");
  }
  const bigWeights = weights.map((weight) => {
    if (!Number.isSafeInteger(weight) || weight < 0) throw new TypeError("allocation weights must be non-negative safe integers");
    return BigInt(weight);
  });
  const denominator = bigWeights.reduce((sum, weight) => sum + weight, 0n);
  if (totalCents === 0) return weights.map(() => 0);
  if (denominator === 0n) throw httpError(400, "Cannot distribute a non-zero amount across zero-value allocations");

  const total = BigInt(totalCents);
  const shares = bigWeights.map((weight) => (total * weight) / denominator);
  const remainders = bigWeights.map((weight, index) => ({ index, remainder: (total * weight) % denominator }));
  const floorTotal = shares.reduce((sum, share) => sum + share, 0n);
  const centsLeft = Number(total - floorTotal);
  remainders.sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index;
    return left.remainder > right.remainder ? -1 : 1;
  });
  for (let index = 0; index < centsLeft; index += 1) shares[remainders[index].index] += 1n;
  return shares.map(Number);
}

function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeCommonFields(body) {
  const { receiptImageURL, vendorName, receiptDate, category } = body;
  if (typeof receiptImageURL !== "string" || !receiptImageURL.trim()) throw httpError(400, "receiptImageURL is required");
  if (typeof vendorName !== "string" || !vendorName.trim()) throw httpError(400, "vendorName is required");
  if (!isCalendarDate(receiptDate)) throw httpError(400, "receiptDate must be a valid YYYY-MM-DD date");
  if (!VALID_CATEGORIES.includes(category)) throw httpError(400, `category must be one of: ${VALID_CATEGORIES.join(", ")}`);

  return {
    receiptImageURL: receiptImageURL.trim(),
    vendorName: vendorName.trim(),
    receiptDate,
    category,
    tin: typeof body.tin === "string" && body.tin.trim() ? body.tin.trim() : null,
    birPermitNumber: typeof body.birPermitNumber === "string" && body.birPermitNumber.trim() ? body.birPermitNumber.trim() : null,
    birNumber: typeof body.birNumber === "string" && body.birNumber.trim() ? body.birNumber.trim() : null,
    receiptTotalCents: parseMoneyCents(body.receiptTotal, "receiptTotal"),
  };
}

function normalizeProjectID(value, fieldName) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw httpError(400, `${fieldName} must be a valid UUID`);
  return value.toLowerCase();
}

function validateAdjustmentType(type, deltaCents) {
  if (deltaCents === 0) {
    if (type != null && type !== "none") throw httpError(400, "adjustmentType is not allowed when the line-item subtotal matches receiptTotal");
    return null;
  }
  if (typeof type !== "string" || !VALID_ADJUSTMENT_TYPES.has(type)) {
    throw httpError(400, "When line items differ from receiptTotal, choose adjustmentType: tax, discount, fee, rounding, or other");
  }
  if (deltaCents > 0 && type === "discount") throw httpError(400, "A discount adjustment must reduce the line-item subtotal");
  if (deltaCents < 0 && ["tax", "fee"].includes(type)) throw httpError(400, `A ${type} adjustment must increase the line-item subtotal`);
  return type;
}

function validateItemizedAllocation(body, common) {
  if (!Array.isArray(body.lineItems) || body.lineItems.length === 0) throw httpError(400, "lineItems must include at least one receipt line");
  if (Array.isArray(body.manualAmountAllocations) && body.manualAmountAllocations.length > 0) {
    throw httpError(400, "Use either itemized allocations or manualAmountAllocations, not both");
  }
  if (!Array.isArray(body.allocations) || body.allocations.length === 0) {
    throw httpError(400, "allocations must contain at least one line-to-project quantity assignment");
  }

  const lineNumberSet = new Set();
  const lineItems = body.lineItems.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw httpError(400, `lineItems[${index}] must be an object`);
    const lineNumber = item.lineNumber == null ? index + 1 : item.lineNumber;
    if (!Number.isSafeInteger(lineNumber) || lineNumber < 1 || lineNumberSet.has(lineNumber)) {
      throw httpError(400, `lineItems[${index}].lineNumber must be a unique positive integer`);
    }
    lineNumberSet.add(lineNumber);
    if (typeof item.description !== "string" || !item.description.trim()) throw httpError(400, `lineItems[${index}].description is required`);
    const quantityHundredths = parseQuantityHundredths(item.quantity, `lineItems[${index}].quantity`);
    const amountCents = parseMoneyCents(item.amount, `lineItems[${index}].amount`);
    const unitPriceCents = item.unitPrice == null || item.unitPrice === "" ? null : parseMoneyCents(item.unitPrice, `lineItems[${index}].unitPrice`);
    return {
      lineNumber,
      description: item.description.trim(),
      quantityHundredths,
      quantity: Number(formatQuantityHundredths(quantityHundredths)),
      amountCents,
      amount: formatMoneyCents(amountCents),
      unitPriceCents,
      unitPrice: unitPriceCents == null ? null : formatMoneyCents(unitPriceCents),
    };
  });

  const lineByNumber = new Map(lineItems.map((line) => [line.lineNumber, line]));
  const seenLineProject = new Set();
  const projectIDs = new Set();
  const allocations = body.allocations.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw httpError(400, `allocations[${index}] must be an object`);
    const lineNumber = entry.lineNumber;
    if (!Number.isSafeInteger(lineNumber) || !lineByNumber.has(lineNumber)) throw httpError(400, `allocations[${index}].lineNumber must reference a lineItems entry`);
    const projectID = normalizeProjectID(entry.projectID, `allocations[${index}].projectID`);
    const pairKey = `${lineNumber}:${projectID}`;
    if (seenLineProject.has(pairKey)) throw httpError(400, `line ${lineNumber} may have only one allocation row per project; combine its quantities`);
    seenLineProject.add(pairKey);
    const allocatedQuantityHundredths = parseQuantityHundredths(entry.quantity, `allocations[${index}].quantity`);
    projectIDs.add(projectID);
    return {
      lineNumber,
      projectID,
      allocatedQuantityHundredths,
      allocatedQuantity: formatQuantityHundredths(allocatedQuantityHundredths),
      baseAmountCents: 0,
      adjustmentAmountCents: 0,
      allocatedAmountCents: 0,
    };
  });
  allocations.sort((left, right) => left.lineNumber - right.lineNumber || left.projectID.localeCompare(right.projectID));
  if (projectIDs.size < 2) throw httpError(400, "A split receipt must allocate to at least two distinct projects");

  for (const line of lineItems) {
    const lineAllocations = allocations
      .filter((allocation) => allocation.lineNumber === line.lineNumber)
      .sort((left, right) => left.projectID.localeCompare(right.projectID));
    if (lineAllocations.length === 0) throw httpError(400, `Receipt line ${line.lineNumber} has no project allocation`);
    const allocatedQuantity = lineAllocations.reduce((sum, allocation) => sum + allocation.allocatedQuantityHundredths, 0);
    if (!Number.isSafeInteger(allocatedQuantity) || allocatedQuantity !== line.quantityHundredths) {
      throw httpError(400, `Receipt line ${line.lineNumber} quantity must be fully allocated (${formatQuantityHundredths(line.quantityHundredths)}); received ${formatQuantityHundredths(allocatedQuantity)}`);
    }
    const amountShares = distributeCents(line.amountCents, lineAllocations.map((allocation) => allocation.allocatedQuantityHundredths));
    lineAllocations.forEach((allocation, index) => { allocation.baseAmountCents = amountShares[index]; });
  }

  const lineSubtotalCents = lineItems.reduce((sum, line) => sum + line.amountCents, 0);
  if (!Number.isSafeInteger(lineSubtotalCents)) throw httpError(400, "Sum of receipt line amounts exceeds the supported range");
  const adjustmentAmountCents = common.receiptTotalCents - lineSubtotalCents;
  const adjustmentType = validateAdjustmentType(body.adjustmentType, adjustmentAmountCents);

  if (adjustmentAmountCents !== 0) {
    const adjustmentShares = distributeCents(
      Math.abs(adjustmentAmountCents),
      allocations.map((allocation) => allocation.baseAmountCents)
    );
    const sign = Math.sign(adjustmentAmountCents);
    allocations.forEach((allocation, index) => {
      allocation.adjustmentAmountCents = sign * adjustmentShares[index];
    });
  }

  const projects = new Map();
  for (const allocation of allocations) {
    allocation.allocatedAmountCents = allocation.baseAmountCents + allocation.adjustmentAmountCents;
    if (allocation.allocatedAmountCents < 0 || allocation.allocatedAmountCents > MAX_AMOUNT_CENTS) {
      throw httpError(400, `Allocation for line ${allocation.lineNumber} would produce an unsupported or negative project amount`);
    }
    if (!projects.has(allocation.projectID)) {
      projects.set(allocation.projectID, { projectID: allocation.projectID, amountCents: 0, quantityHundredths: 0, lineItems: [], allocations: [] });
    }
    const project = projects.get(allocation.projectID);
    project.amountCents += allocation.allocatedAmountCents;
    project.quantityHundredths += allocation.allocatedQuantityHundredths;
    const sourceLine = lineByNumber.get(allocation.lineNumber);
    project.lineItems.push({
      lineNumber: sourceLine.lineNumber,
      description: sourceLine.description,
      quantity: Number(formatQuantityHundredths(allocation.allocatedQuantityHundredths)),
      amount: Number(formatMoneyCents(allocation.allocatedAmountCents)),
      unitPrice: sourceLine.unitPriceCents == null ? null : Number(formatMoneyCents(sourceLine.unitPriceCents)),
    });
    project.allocations.push(allocation);
  }
  for (const project of projects.values()) {
    if (!Number.isSafeInteger(project.quantityHundredths) || project.quantityHundredths > MAX_QUANTITY_HUNDREDTHS) {
      throw httpError(400, `Total quantity allocated to project ${project.projectID} exceeds the supported amount`);
    }
    if (!Number.isSafeInteger(project.amountCents) || project.amountCents > MAX_AMOUNT_CENTS) {
      throw httpError(400, `Total allocated to project ${project.projectID} exceeds the supported amount`);
    }
    project.amount = formatMoneyCents(project.amountCents);
    project.quantity = formatQuantityHundredths(project.quantityHundredths);
  }

  const allocatedTotalCents = [...projects.values()].reduce((sum, project) => sum + project.amountCents, 0);
  if (allocatedTotalCents !== common.receiptTotalCents) throw httpError(400, "Calculated project allocations do not equal receiptTotal");

  return {
    ...common,
    mode: "quantity",
    adjustmentType,
    adjustmentAmountCents,
    lineItems,
    allocations,
    projects: [...projects.values()].sort((left, right) => left.projectID.localeCompare(right.projectID)),
  };
}

function validateManualAmountAllocation(body, common) {
  if (Array.isArray(body.lineItems) && body.lineItems.length > 0) throw httpError(400, "Manual amount mode is only for receipts without usable line items");
  if (Array.isArray(body.allocations) && body.allocations.length > 0) throw httpError(400, "Manual amount mode must not include quantity allocations");
  if (body.adjustmentType != null && body.adjustmentType !== "none") throw httpError(400, "adjustmentType is not used in manual amount mode");
  const portions = body.manualAmountAllocations;
  if (!Array.isArray(portions) || portions.length < 2) throw httpError(400, "manualAmountAllocations must contain at least two project amounts");

  const seenProjects = new Set();
  const projects = portions.map((portion, index) => {
    if (!portion || typeof portion !== "object" || Array.isArray(portion)) throw httpError(400, `manualAmountAllocations[${index}] must be an object`);
    const projectID = normalizeProjectID(portion.projectID, `manualAmountAllocations[${index}].projectID`);
    if (seenProjects.has(projectID)) throw httpError(400, "each project may appear only once in manualAmountAllocations");
    seenProjects.add(projectID);
    const amountCents = parseMoneyCents(portion.amount, `manualAmountAllocations[${index}].amount`);
    return {
      projectID,
      amountCents,
      amount: formatMoneyCents(amountCents),
      quantityHundredths: null,
      quantity: null,
      lineItems: [],
      allocations: [{
        lineNumber: null,
        projectID,
        allocatedQuantityHundredths: null,
        allocatedQuantity: null,
        baseAmountCents: amountCents,
        adjustmentAmountCents: 0,
        allocatedAmountCents: amountCents,
      }],
    };
  });

  const allocatedCents = projects.reduce((sum, project) => sum + project.amountCents, 0);
  if (!Number.isSafeInteger(allocatedCents) || allocatedCents !== common.receiptTotalCents) {
    const mismatch = Math.abs(allocatedCents - common.receiptTotalCents);
    throw httpError(400, `Manual project amounts must equal receiptTotal; mismatch ${formatMoneyCents(mismatch)}`);
  }
  return {
    ...common,
    mode: "amount",
    adjustmentType: null,
    adjustmentAmountCents: 0,
    lineItems: [],
    allocations: projects.flatMap((project) => project.allocations),
    projects: projects.sort((left, right) => left.projectID.localeCompare(right.projectID)),
  };
}

function validateAllocationBody(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw httpError(400, "Request body must be an object");
  const common = normalizeCommonFields(body);
  const hasLineItems = Array.isArray(body.lineItems) && body.lineItems.length > 0;
  if (body.lineItems != null && !Array.isArray(body.lineItems)) throw httpError(400, "lineItems must be an array when provided");
  if (body.manualAmountAllocations != null && !Array.isArray(body.manualAmountAllocations)) throw httpError(400, "manualAmountAllocations must be an array when provided");
  return hasLineItems
    ? validateItemizedAllocation(body, common)
    : validateManualAmountAllocation(body, common);
}

module.exports = {
  validateAllocationBody,
  parseMoneyCents,
  parseQuantityHundredths,
  formatMoneyCents,
  formatQuantityHundredths,
  distributeCents,
  VALID_ADJUSTMENT_TYPES,
  UUID_PATTERN,
};
