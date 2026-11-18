// contractRules.js: rules for the construction contract and the client's
// payments against it. Pure functions (no database) so they can be unit tested.
//
// The contract is the signed agreement between the owner (client) and the
// contractor. It is NOT the spending budget. On approval the BOM gives two
// numbers (routes/bom.js): the AGREED PRICE (the BOM total, what the client
// pays) and the project budget (agreed price plus the escalation allowance,
// the most the company may spend). The contract amount should equal the agreed
// price; the budget is normally a little above it.
//
// Client payments follow the pilot contractor's practice: a down payment up
// front, progress billings while the work goes on (based on work done, not a
// fixed schedule), and the retention released at turn-over.

const { LIMITS, InputError, text, amount, collect } = require("./inputRules");
const { round2, manilaToday } = require("./bomRules");

const PAYMENT_KINDS = ["Down Payment", "Progress Billing", "Retention"];
const DEFAULT_DOWN_PAYMENT_PERCENT = 20;
const DEFAULT_RETENTION_PERCENT = 10;
// Same rule as the financial report's "Watch" status: more than 10 points apart.
const COLLECTION_GAP_POINTS = 10;

const MIN_YEAR = 2000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TOLERANCE = 0.005;

function peso(value) {
  return `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const blank = (value) => value === undefined || value === null || value === "";

/** A real calendar date (YYYY-MM-DD) that is not in the future. */
function pastDate(value, { field, label, today, required = true }) {
  if (blank(value)) {
    if (required) throw new InputError(`${label} is required`, field);
    return null;
  }
  const s = typeof value === "string" ? value.trim() : "";
  if (!ISO_DATE_RE.test(s)) throw new InputError(`${label} must be a date (YYYY-MM-DD)`, field);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new InputError(`${label} isn't a real date`, field);
  }
  if (Number(s.slice(0, 4)) < MIN_YEAR) throw new InputError(`${label} must be ${MIN_YEAR} or later`, field);
  if (s > today) throw new InputError(`${label} can't be in the future`, field);
  return s;
}

/** A percentage from 0 to 100, rounded to 2 decimals. */
function percent(value, { field, label, required = true }) {
  if (blank(value)) {
    if (required) throw new InputError(`${label} is required`, field);
    return null;
  }
  let n = value;
  if (typeof n === "string" && /^\d+(\.\d+)?$/.test(n.trim())) n = Number(n.trim());
  if (typeof n !== "number" || !Number.isFinite(n)) throw new InputError(`${label} must be a number`, field);
  n = Math.round(n * 100) / 100;
  if (n < 0 || n > 100) throw new InputError(`${label} must be between 0 and 100`, field);
  return n;
}

/** A whole number from `min` to `max`, or null when blank and optional. */
function wholeNumber(value, { field, label, min = 1, max, required = false }) {
  if (blank(value)) {
    if (required) throw new InputError(`${label} is required`, field);
    return null;
  }
  let n = value;
  if (typeof n === "string" && /^\d+$/.test(n.trim())) n = Number(n.trim());
  if (typeof n !== "number" || !Number.isInteger(n)) throw new InputError(`${label} must be a whole number`, field);
  if (n < min || n > max) throw new InputError(`${label} must be between ${min} and ${max}`, field);
  return n;
}

/**
 * Validate the contract the GM confirms. Returns { errors, value }: errors is a
 * list of { field, message } (empty when valid), value the cleaned values.
 */
function validateContractBody(body, today = manilaToday()) {
  const b = body && typeof body === "object" ? body : {};
  const { errors, values } = collect([
    () => pastDate(b.contractDate, { field: "contractDate", label: "Contract date", today }),
    () => text(b.contractRef, { field: "contractRef", label: "Contract reference", max: 100 }),
    () => text(b.ownerName, { field: "ownerName", label: "Owner (client)", max: LIMITS.clientName, required: true }),
    () => text(b.contractorName, { field: "contractorName", label: "Contractor", max: 150, required: true }),
    () => text(b.contractorRep, { field: "contractorRep", label: "Contractor representative", max: 150 }),
    () => text(b.contractorAddress, { field: "contractorAddress", label: "Contractor address", max: LIMITS.siteAddress }),
    () => text(b.scope, { field: "scope", label: "Scope of work", max: 255 }),
    () => text(b.siteLocation, { field: "siteLocation", label: "Site location", max: LIMITS.siteAddress }),
    () => amount(b.contractAmount, { field: "contractAmount", label: "Contract amount" }),
    () => percent(b.downPaymentPercent, { field: "downPaymentPercent", label: "Down payment %" }),
    () => percent(b.retentionPercent, { field: "retentionPercent", label: "Retention %" }),
    () => wholeNumber(b.durationWorkingDays, { field: "durationWorkingDays", label: "Duration (working days)", max: 3650 }),
    () => wholeNumber(b.warrantyMonths, { field: "warrantyMonths", label: "Warranty (months)", max: 240 }),
    () => text(b.sourceFileName, { field: "sourceFileName", label: "File name", max: 255 }),
  ]);
  // Text from a document often has doubled spaces: keep one.
  const tidy = (v) => (typeof v === "string" ? v.replace(/ {2,}/g, " ") : v);
  const [
    contractDate, contractRef, ownerName, contractorName, contractorRep, contractorAddress, scope,
    siteLocation, contractAmount, downPaymentPercent, retentionPercent, durationWorkingDays,
    warrantyMonths, sourceFileName,
  ] = values.map(tidy);

  if (
    typeof downPaymentPercent === "number" &&
    typeof retentionPercent === "number" &&
    round2(downPaymentPercent + retentionPercent) > 100
  ) {
    errors.push({ field: "retentionPercent", message: "Down payment % and retention % together can't be more than 100" });
  }

  return {
    errors,
    value: {
      contractDate, contractRef, ownerName, contractorName, contractorRep, contractorAddress, scope,
      siteLocation, contractAmount, downPaymentPercent, retentionPercent, durationWorkingDays,
      warrantyMonths, sourceFileName,
    },
  };
}

/** What the contract amount splits into. */
function paymentSchedule({ contractAmount, downPaymentPercent, retentionPercent }) {
  const total = round2(Number(contractAmount));
  const down = round2((total * Number(downPaymentPercent)) / 100);
  const retention = round2((total * Number(retentionPercent)) / 100);
  return {
    contractAmount: total,
    downPaymentAmount: down,
    retentionAmount: retention,
    progressBillingsAmount: round2(total - down - retention),
  };
}

/** Validate one payment the GM records. Returns { errors, value }. */
function validatePaymentBody(body, today = manilaToday()) {
  const b = body && typeof body === "object" ? body : {};
  const kind = typeof b.kind === "string" ? b.kind.trim() : "";
  const { errors, values } = collect([
    () => {
      if (!PAYMENT_KINDS.includes(kind)) {
        throw new InputError(`Payment type must be one of: ${PAYMENT_KINDS.join(", ")}`, "kind");
      }
      return kind;
    },
    () => amount(b.amount, { field: "amount", label: "Amount" }),
    () => pastDate(b.receivedOn, { field: "receivedOn", label: "Date received", today }),
    () => text(b.referenceNo, { field: "referenceNo", label: "Reference (OR or bank)", max: 100 }),
    () => percent(b.workDonePercent, { field: "workDonePercent", label: "Work done %", required: false }),
    () => text(b.note, { field: "note", label: "Note", max: LIMITS.reason, multiline: true }),
  ]);
  const [k, amt, receivedOn, referenceNo, workDonePercent, note] = values;
  return {
    errors,
    value: {
      kind: k,
      amount: amt,
      receivedOn,
      referenceNo,
      // Work done only means something on a progress billing.
      workDonePercent: k === "Progress Billing" ? workDonePercent : null,
      note,
    },
  };
}

const sumOf = (payments) => round2(payments.reduce((total, p) => total + Number(p.amount), 0));

/**
 * Why a new payment can't be recorded, or null when it can. `livePayments`
 * are the contract's payments that are not voided.
 *  - one down payment and one retention per contract
 *  - the retention is held back until turn-over (the project is Completed)
 *  - everything except the retention can't go past contract amount minus retention
 *  - the total can't pass the contract amount
 */
function paymentProblem({ kind, amount: paid }, contract, livePayments, projectStatus) {
  const schedule = paymentSchedule(contract);
  if (kind === "Down Payment" && livePayments.some((p) => p.kind === "Down Payment")) {
    return "The down payment is already recorded. Void it first if it was entered wrong.";
  }
  if (kind === "Retention") {
    if (projectStatus !== "Completed") {
      return "The retention is released at turn-over, so it can only be recorded once the project is Completed.";
    }
    if (livePayments.some((p) => p.kind === "Retention")) {
      return "The retention is already recorded. Void it first if it was entered wrong.";
    }
    if (paid > schedule.retentionAmount + TOLERANCE) {
      return `The retention is ${peso(schedule.retentionAmount)}. The amount can't be more than that.`;
    }
  } else {
    const room = round2(schedule.contractAmount - schedule.retentionAmount - sumOf(livePayments.filter((p) => p.kind !== "Retention")));
    if (paid > room + TOLERANCE) {
      return `Only ${peso(Math.max(room, 0))} can still be collected before turn-over (the ${peso(schedule.retentionAmount)} retention is held back until then).`;
    }
  }
  if (round2(sumOf(livePayments) + paid) > schedule.contractAmount + TOLERANCE) {
    return `Total payments can't be more than the contract amount (${peso(schedule.contractAmount)}).`;
  }
  return null;
}

/**
 * Why a contract change would contradict the payments already recorded, or
 * null. `next` is the new { contractAmount, downPaymentPercent, retentionPercent }.
 */
function contractChangeProblem(next, livePayments) {
  const schedule = paymentSchedule(next);
  const retentionPaid = sumOf(livePayments.filter((p) => p.kind === "Retention"));
  const otherPaid = sumOf(livePayments.filter((p) => p.kind !== "Retention"));
  if (otherPaid > round2(schedule.contractAmount - schedule.retentionAmount) + TOLERANCE) {
    return `${peso(otherPaid)} has already been received, which is more than this contract allows before retention (${peso(
      round2(schedule.contractAmount - schedule.retentionAmount)
    )}). Void the wrong payments first, or correct the amount or percentages.`;
  }
  if (retentionPaid > schedule.retentionAmount + TOLERANCE) {
    return `${peso(retentionPaid)} of retention has already been received, which is more than the new retention (${peso(schedule.retentionAmount)}).`;
  }
  return null;
}

/** How far the contract amount is from the price agreed on the approved BOM. */
function priceDifference(contractAmount, agreedPrice) {
  const price = Number(agreedPrice);
  if (agreedPrice === null || agreedPrice === undefined || !Number.isFinite(price) || price <= 0) return null;
  const difference = round2(Number(contractAmount) - price);
  return { agreedPrice: round2(price), difference, differs: Math.abs(difference) >= TOLERANCE };
}

/**
 * Shown when the GM is about to approve a BOM whose total is not the amount on
 * the recorded contract. It is a warning that needs a tick, never a block:
 * approving still sets the agreed price to the BOM total.
 */
function bomContractWarning(contractAmount, bomPrice) {
  const diff = priceDifference(contractAmount, bomPrice);
  if (!diff || !diff.differs) return null;
  const direction = diff.difference > 0 ? "higher" : "lower";
  return {
    level: "warning",
    code: "CONTRACT_DIFFERS_FROM_BOM",
    message: `The recorded contract amount (${peso(contractAmount)}) is ${peso(Math.abs(diff.difference))} ${direction} than this BOM total (${peso(diff.agreedPrice)}). Approving sets the agreed price to the BOM total. Check which one is right first.`,
  };
}

/**
 * The finance picture of one project.
 *   contract      { contractAmount, downPaymentPercent, retentionPercent }
 *   payments      every payment, voided ones included ({ kind, amount, voidedAt })
 *   spent         approved expenses so far (same definition as the financial report)
 *   agreedPrice   the price agreed on the approved BOM, or null when the BOM isn't approved
 *   projectBudget the project's budget (agreed price + escalation), or null
 *   workDonePercent  average milestone completion, or null when there are no milestones
 * Income is not budget: nothing here changes the spending budget.
 */
function ledgerSummary({ contract, payments, spent, agreedPrice = null, projectBudget = null, workDonePercent = null }) {
  const live = payments.filter((p) => !p.voidedAt);
  const schedule = paymentSchedule(contract);
  const received = sumOf(live);
  const receivedPercent = schedule.contractAmount > 0 ? round2((received / schedule.contractAmount) * 100) : 0;
  const spentTotal = round2(Number(spent) || 0);
  const cashPosition = round2(received - spentTotal);

  const warnings = [];
  if (!live.some((p) => p.kind === "Down Payment") && schedule.downPaymentAmount > 0) {
    warnings.push({
      code: "DOWN_PAYMENT_NOT_RECORDED",
      level: "info",
      message: `The down payment (${peso(schedule.downPaymentAmount)}) hasn't been recorded yet.`,
    });
  }
  if (spentTotal > received + TOLERANCE) {
    warnings.push({
      code: "SPEND_AHEAD_OF_CASH",
      level: "warning",
      message: `Approved spending (${peso(spentTotal)}) is more than the cash received from the client (${peso(received)}). The company is financing the difference.`,
    });
  }
  if (typeof workDonePercent === "number" && workDonePercent - receivedPercent > COLLECTION_GAP_POINTS) {
    warnings.push({
      code: "COLLECTION_BEHIND_WORK",
      level: "warning",
      message: `${workDonePercent}% of the work is done but only ${receivedPercent}% of the contract has been collected. A progress billing may be due.`,
    });
  }
  const difference = priceDifference(schedule.contractAmount, agreedPrice);
  if (difference?.differs) {
    warnings.push({
      code: "CONTRACT_DIFFERS_FROM_AGREED_PRICE",
      level: "warning",
      message: `The contract amount (${peso(schedule.contractAmount)}) differs from the price agreed on the approved BOM (${peso(difference.agreedPrice)}) by ${peso(Math.abs(difference.difference))}.`,
    });
  }
  const budget = Number(projectBudget);
  if (Number.isFinite(budget) && budget > schedule.contractAmount + TOLERANCE) {
    warnings.push({
      code: "BUDGET_ABOVE_CONTRACT",
      level: "info",
      message: `The project budget (${peso(budget)}) is ${peso(round2(budget - schedule.contractAmount))} above the contract amount (the escalation allowance). Spending past the contract amount comes out of the company's margin.`,
    });
  }

  return {
    ...schedule,
    receivedTotal: received,
    receivedPercent,
    remainingToCollect: round2(schedule.contractAmount - received),
    receivedByKind: Object.fromEntries(PAYMENT_KINDS.map((k) => [k, sumOf(live.filter((p) => p.kind === k))])),
    spentToDate: spentTotal,
    cashPosition,
    workDonePercent: typeof workDonePercent === "number" ? workDonePercent : null,
    priceDifference: difference,
    warnings,
  };
}

module.exports = {
  PAYMENT_KINDS,
  DEFAULT_DOWN_PAYMENT_PERCENT,
  DEFAULT_RETENTION_PERCENT,
  COLLECTION_GAP_POINTS,
  manilaToday,
  peso,
  validateContractBody,
  validatePaymentBody,
  paymentSchedule,
  paymentProblem,
  contractChangeProblem,
  priceDifference,
  bomContractWarning,
  ledgerSummary,
};
