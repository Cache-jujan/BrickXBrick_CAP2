// Client-side checks for the receipt review screen. The server re-checks
// everything on submit; these only stop obvious mistakes before then.

// "2026-10-09" -> true. Rejects impossible dates (2026-02-30), anything not
// YYYY-MM-DD, years before 2000, and dates more than a day in the future
// (one day of slack covers time-zone differences with the server).
export function receiptDateProblem(text: string): string | null {
  const value = text.trim();
  if (!value) return "Enter the receipt date.";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return "Use YYYY-MM-DD, e.g. 2026-10-09.";
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return "That date doesn't exist.";
  }
  if (year < 2000) return "Check the year.";
  const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
  if (date.getTime() > tomorrow) return "The date is in the future.";
  return null;
}

// Mirrors the server's classifyBir: Formal needs TIN, BIR permit and OR/SI.
// The server classifies again on submit; this is a preview.
export function birStatusPreview(fields: { tin: string; birPermitNumber: string; birNumber: string }) {
  const missing: string[] = [];
  if (!fields.tin.replace(/\D/g, "")) missing.push("TIN");
  if (!fields.birPermitNumber.replace(/[\s-]/g, "")) missing.push("BIR permit");
  if (!fields.birNumber.replace(/[\s-]/g, "")) missing.push("OR/SI");
  return { formal: missing.length === 0, missing };
}
