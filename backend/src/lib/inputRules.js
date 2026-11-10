// inputRules.js — one place for the rules every typed-in value must pass.
//
// Server-side validation is the authority (the web and phone checks only help
// the user earlier). Each helper does the same four things the usual input
// guidance asks for: check the TYPE (a string is a string, not an array or
// object), NORMALISE (trim, drop control characters), enforce LENGTH or RANGE
// (the limits below match the database columns, so nothing reaches Postgres
// only to fail there with a 500), and fail with a short message that names the
// field and says how to fix it.
//
const { isUUID } = require("./uuid");

// The limits are also in shared/input-limits.json, which the web and phone
// import; backend/test/inputLimits.test.js keeps the two copies equal.

/** Limits that mirror the database columns (characters, or the largest amount). */
const LIMITS = Object.freeze({
  userName: 100,
  email: 150,
  projectName: 150,
  clientName: 150,
  municipality: 100,
  province: 100,
  siteAddress: 255,
  taskName: 150,
  milestoneName: 150,
  ticketSubject: 100,
  materialType: 100,
  unit: 30,
  vendorName: 200,
  bomDescription: 200,
  // Free text stored in TEXT columns gets a sensible cap instead of "unlimited".
  description: 2000,
  note: 1000,
  reason: 500,
  // numeric(12,2), numeric(10,2) and numeric(15,2) columns.
  moneyMax: 9999999999.99,
  quantityMax: 99999999.99,
  projectBudgetMax: 9999999999999.99,
});

class InputError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "InputError";
    this.status = 400;
    this.field = field || null;
    this.fieldErrors = field ? [{ field, message }] : [];
    // The shared error handler in server.js sends `details` with the message.
    this.details = { fieldErrors: this.fieldErrors };
  }
}

// Control characters other than tab and line breaks have no place in typed text.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const LINE_BREAKS = /[\r\n\t]+/g;

const charCount = (s) => Array.from(s).length;

/**
 * Clean a text value.
 * Returns the trimmed string, or null when it is empty and not required.
 * `multiline` keeps line breaks (descriptions, notes); other fields are one line.
 */
function text(value, { field, label, max, min = 0, required = false, multiline = false }) {
  const name = label || field || "This field";
  if (value === undefined || value === null) {
    if (required) throw new InputError(`${name} is required`, field);
    return null;
  }
  if (typeof value !== "string") throw new InputError(`${name} must be text`, field);

  let s = value.replace(/\r\n?/g, "\n").replace(CONTROL_CHARS, "");
  if (!multiline) s = s.replace(LINE_BREAKS, " ");
  s = s.trim();

  if (!s) {
    if (required) throw new InputError(`${name} is required`, field);
    return null;
  }
  if (min && charCount(s) < min) {
    throw new InputError(`${name} must be at least ${min} characters`, field);
  }
  if (max && charCount(s) > max) {
    throw new InputError(`${name} must be ${max} characters or fewer`, field);
  }
  return s;
}

/**
 * A money amount (PHP). Accepts a number or a plain numeric string, rounds to
 * centavos, and keeps it inside the column's range. `allowZero` is for fields
 * where 0 means "none" (a budget of 0 is allowed on a project, an expense of 0 is not).
 */
function amount(value, { field, label, max = LIMITS.moneyMax, allowZero = false, required = true }) {
  const name = label || field || "Amount";
  if (value === undefined || value === null || value === "") {
    if (required) throw new InputError(`${name} is required`, field);
    return null;
  }
  let n = value;
  if (typeof n === "string" && /^\d+(\.\d+)?$/.test(n.trim())) n = Number(n.trim());
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new InputError(`${name} must be a number`, field);
  }
  n = Math.round(n * 100) / 100;
  if (allowZero ? n < 0 : n <= 0) {
    throw new InputError(`${name} must be ${allowZero ? "0 or more" : "more than 0"}`, field);
  }
  if (n > max) {
    throw new InputError(`${name} must not be more than ${max.toLocaleString("en-US", { maximumFractionDigits: 2 })}`, field);
  }
  return n;
}

/** A quantity of material: more than 0, at most the numeric(10,2) range. */
function quantity(value, { field = "quantity", label = "Quantity", required = true } = {}) {
  return amount(value, { field, label, max: LIMITS.quantityMax, required });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A lower-case email address of a sensible length. */
function email(value, { field = "email", label = "Email", required = true } = {}) {
  const s = text(value, { field, label, max: LIMITS.email, required });
  if (s === null) return null;
  const lower = s.toLowerCase();
  if (!EMAIL_RE.test(lower)) throw new InputError(`${label} must be a valid email address`, field);
  return lower;
}

/** An id in the form the database expects, so a typo is a 400 and not a database error. */
function uuid(value, { field, label, required = true }) {
  const name = label || field || "Id";
  if (value === undefined || value === null || value === "") {
    if (required) throw new InputError(`${name} is required`, field);
    return null;
  }
  if (typeof value !== "string" || !isUUID(value.trim())) {
    throw new InputError(`${name} is not a valid id`, field);
  }
  return value.trim();
}

/**
 * Run several checks and collect every problem, for forms with many fields.
 * `checks` is a list of functions; the ones that throw an InputError add to the list.
 */
function collect(checks) {
  const errors = [];
  const values = [];
  for (const check of checks) {
    try {
      values.push(check());
    } catch (err) {
      if (!(err instanceof InputError)) throw err;
      errors.push({ field: err.field, message: err.message });
      values.push(undefined);
    }
  }
  return { errors, values };
}

module.exports = { LIMITS, InputError, text, amount, quantity, email, uuid, collect };
