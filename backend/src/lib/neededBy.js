// neededBy.js — validation for a ticket's optional "needed by" date.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Today as YYYY-MM-DD in local time. */
function todayText(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Turn the request value into a YYYY-MM-DD string, or null when no date was given.
 * Throws a 400 error for a bad format, an impossible date, or a date in the past.
 */
function parseNeededBy(value, now = new Date()) {
  if (value === undefined || value === null || value === "") return null;

  const fail = (message) => {
    const err = new Error(message);
    err.status = 400;
    return err;
  };

  if (typeof value !== "string" || !DATE_ONLY.test(value)) {
    throw fail("neededBy must be a date in YYYY-MM-DD format");
  }
  // Date.UTC rolls 2026-02-30 over to March, so compare the round trip.
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw fail("neededBy is not a real calendar date");
  }
  if (value < todayText(now)) {
    throw fail("neededBy cannot be in the past");
  }
  return value;
}

module.exports = { parseNeededBy, todayText };
