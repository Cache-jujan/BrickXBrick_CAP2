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

// Receipt dates are calendar days, so they are built from LOCAL date parts.
// toISOString() would shift to UTC and give yesterday before 8am in Manila.
export function dateToIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayIso(): string {
  return dateToIso(new Date());
}

// "2026-10-09" -> local Date; anything else -> today.
export function isoToDate(text: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
}

// "2026-10-09" -> "Oct 9, 2026"
export function formatReceiptDate(text: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text.trim())) return text;
  return isoToDate(text).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

// The reconciliation line's name starts with this. The server flags any
// expense carrying one for PM review (backend screenExpense.js, Layer 4).
export const ADJUSTMENT_PREFIX = "Adjustment";

export type ReconcileFix =
  // Lines are short of the total: add a quantity-0 line for the gap.
  | { kind: "add"; gapCents: number }
  // Lines exceed the total (unlisted discount): take the gap off one line.
  | { kind: "discount"; gapCents: number; itemId: string; itemName: string }
  | null;

// What one tap can do to make the lines add up to the receipt total.
// Returns null when the totals already match or no single fix works.
export function reconcileFix(
  totalCents: number | null,
  lines: { id: string; name: string; cents: number | null }[]
): ReconcileFix {
  if (totalCents === null || lines.some((l) => l.cents === null)) return null;
  const linesCents = lines.reduce((sum, l) => sum + (l.cents ?? 0), 0);
  const gap = totalCents - linesCents;
  if (gap === 0) return null;
  if (gap > 0) return { kind: "add", gapCents: gap };
  // Discount: take it off the largest line, which can absorb it.
  const largest = [...lines].sort((a, b) => (b.cents ?? 0) - (a.cents ?? 0))[0];
  if (!largest || (largest.cents ?? 0) < -gap) return null;
  return { kind: "discount", gapCents: -gap, itemId: largest.id, itemName: largest.name };
}
