import { PESO_EXACT } from "./plainLanguage";

// Cost variance = spend to date minus budget (the server works it out:
// varianceToDate / varianceToDatePct in GET /api/reports/summary). Negative is
// under budget, positive is over. These only format it.

// A real minus sign (U+2212), not a hyphen: a hyphen lets a long figure break
// onto two lines right after the sign, and "−" does not.
const MINUS = "\u2212";
const sign = (value) => (value > 0 ? "+" : value < 0 ? MINUS : "");

// "−₱6,500.00" (under budget) or "+₱1,000.00" (over budget).
export function signedPeso(value) {
  if (!Number.isFinite(value)) return "n/a"; // an older server without the field
  return `${sign(value)}${PESO_EXACT.format(Math.abs(value))}`;
}

// "−65.0%" / "+25.0%", or "n/a" when the project has no budget to compare with.
export function signedPct(value, digits = 1) {
  if (!Number.isFinite(value)) return "n/a"; // no budget, or an older server without the field
  return `${sign(value)}${Math.abs(value).toFixed(digits)}%`;
}

export const signedPesoShort = (value) => `${sign(value)}${new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(Math.abs(value))}`;

// Always written out, so the meaning never depends on colour alone.
// `t` is the translate function from useLocale().
export function varianceWords(value, t) {
  if (value > 0) return t("dashboard.over_budget");
  if (value < 0) return t("rep.words_under");
  return t("rep.words_on");
}
