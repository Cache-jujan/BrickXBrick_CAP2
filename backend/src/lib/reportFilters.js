// reportFilters.js — validate the F11 report filters (projectIds, from, to).
// Pure: no database. The route turns the thrown error into a 400.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PROJECTS = 5; // manuscript scope
const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

function validationError(fieldErrors) {
  const error = new Error(fieldErrors.map((e) => e.message).join("; "));
  error.status = 400;
  error.details = { fieldErrors };
  return error;
}

// "2026-02-30" matches the shape but is not a real day.
function parseDay(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

// projectIds may be "a,b" (query string), an array, or one id.
function toIdList(value) {
  if (value === undefined || value === null || value === "") return [];
  const list = Array.isArray(value) ? value : String(value).split(",");
  return list.map((id) => String(id).trim().toLowerCase()).filter(Boolean);
}

/** Returns { projectIds, from, to } (ids lower-cased, de-duplicated) or throws a 400. */
function validateReportFilters(input) {
  const body = input || {};
  const errors = [];

  const projectIds = [...new Set(toIdList(body.projectIds))];
  if (projectIds.length === 0) {
    errors.push({ field: "projectIds", message: "Select at least one project" });
  } else if (projectIds.length > MAX_PROJECTS) {
    errors.push({ field: "projectIds", message: `Select at most ${MAX_PROJECTS} projects` });
  } else if (projectIds.some((id) => !UUID_RE.test(id))) {
    errors.push({ field: "projectIds", message: "projectIds must be project ids" });
  }

  const fromTime = parseDay(body.from);
  const toTime = parseDay(body.to);
  if (fromTime === null) errors.push({ field: "from", message: "from must be a date like 2026-10-01" });
  if (toTime === null) errors.push({ field: "to", message: "to must be a date like 2026-10-31" });
  if (fromTime !== null && toTime !== null) {
    if (fromTime > toTime) {
      errors.push({ field: "from", message: "from must be on or before to" });
    } else if ((toTime - fromTime) / DAY_MS + 1 > MAX_RANGE_DAYS) {
      errors.push({ field: "to", message: `The date range can be at most ${MAX_RANGE_DAYS} days` });
    }
  }

  if (errors.length) throw validationError(errors);
  return { projectIds, from: body.from, to: body.to };
}

const PNG_PREFIX = "data:image/png;base64,";
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const MAX_CHART_CHARS = 1_500_000; // about 1.1 MB of PNG

// The chart is the only thing the browser sends that ends up in the PDF.
// Accept a PNG data URL only: right prefix, sane size, valid base64, and the
// decoded bytes really start like a PNG. Returns the same string.
function validateChartImage(value) {
  const fail = (message) => validationError([{ field: "chartImage", message }]);
  if (typeof value !== "string" || !value.startsWith(PNG_PREFIX)) {
    throw fail("chartImage must be a PNG data URL (data:image/png;base64,...)");
  }
  if (value.length > MAX_CHART_CHARS) throw fail("chartImage is too large (about 1.5 MB at most)");
  const data = value.slice(PNG_PREFIX.length);
  if (data.length === 0 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw fail("chartImage is not valid base64");
  }
  const bytes = Buffer.from(data, "base64");
  if (!PNG_MAGIC.every((byte, i) => bytes[i] === byte)) throw fail("chartImage is not a PNG image");
  return value;
}

module.exports = { validateReportFilters, validateChartImage, MAX_PROJECTS, MAX_RANGE_DAYS, MAX_CHART_CHARS };
