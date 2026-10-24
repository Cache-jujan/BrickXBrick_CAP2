// Helpers for a ticket's optional "needed by" date.
//
// The API sends the DATE column as an ISO string (e.g. "2026-10-21T00:00:00.000Z").
// Read it with local getters, so the day matches the one the user picked.

export type Urgency = {
  label: string;
  tone: "late" | "today" | "soon" | "normal" | "none";
  // Whole days from today to the date; negative once overdue. null: no date.
  days: number | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** "YYYY-MM-DD" for a local Date, the format the API expects. */
export function toDateText(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Parse an API value ("2026-10-21" or a full ISO string) into a local day. */
export function parseNeededBy(value?: string | null): Date | null {
  if (!value) return null;
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = plain ? new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3])) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : startOfDay(date);
}

/** "23 Oct" style label. */
export function shortDate(date: Date, intlLocale = "en-PH") {
  return date.toLocaleDateString(intlLocale, { day: "numeric", month: "short" });
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

// `t` and `intlLocale` (from useLocale) are optional: with them the label follows the chosen language.
export function urgencyFor(value?: string | null, now = new Date(), t?: Translate, intlLocale = "en-PH"): Urgency {
  const due = parseNeededBy(value);
  if (!due) return { label: t ? t("due.none") : "No due date", tone: "none", days: null };

  const days = Math.round((due.getTime() - startOfDay(now).getTime()) / MS_PER_DAY);
  if (days < 0) {
    const late = Math.abs(days);
    const label = t ? t(late === 1 ? "due.overdue_one" : "due.overdue_other", { count: late }) : `Overdue by ${late} ${late === 1 ? "day" : "days"}`;
    return { label, tone: "late", days };
  }
  if (days === 0) return { label: t ? t("due.needed_today") : "Needed today", tone: "today", days };
  if (days <= 3) {
    const label = t ? t(days === 1 ? "due.in_one" : "due.in_other", { count: days }) : `Due in ${days} ${days === 1 ? "day" : "days"}`;
    return { label, tone: "soon", days };
  }
  const label = t ? t("ms.due", { date: shortDate(due, intlLocale) }) : `Due ${shortDate(due)}`;
  return { label, tone: "normal", days };
}

/** Sort key: earliest due date first, tickets with no date last. */
export function dueSortKey(value?: string | null) {
  return parseNeededBy(value)?.getTime() ?? Number.POSITIVE_INFINITY;
}
