// How the History tab arranges the Purchaser's submitted receipts. Pure, so it is
// tested in Node (lib/sync/test/history-groups.test.mjs).
//
// A receipt shared across projects is stored as one expense per project, all with the
// same commonReceiptID. History shows those as one receipt with its portions listed.

const STATUS_RANK = { Rejected: 3, Pending: 2, Approved: 1 };

/** The day an expense belongs to, as YYYY-MM-DD in the phone's own time zone. */
export function dayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The status to show for a receipt: Rejected wins over Pending, which wins over Approved. */
export function worstStatus(items) {
  return items.reduce((worst, e) => ((STATUS_RANK[e.status] ?? 0) > (STATUS_RANK[worst] ?? 0) ? e.status : worst), items[0].status);
}

/**
 * @param {{ expenseID: string, amount: string|number, status: string, submittedAt: string, commonReceiptID?: string|null }[]} expenses
 * @returns {{ day: string, receipts: { key: string, items: typeof expenses, total: number, status: string, submittedAt: string }[] }[]}
 *   newest day first, newest receipt first within a day
 */
export function groupReceipts(expenses) {
  const byKey = new Map();
  for (const e of Array.isArray(expenses) ? expenses : []) {
    const key = e.commonReceiptID ? `r:${e.commonReceiptID}` : `e:${e.expenseID}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(e);
  }

  const days = new Map();
  for (const [key, items] of byKey) {
    const submittedAt = items.reduce((newest, e) => (Date.parse(e.submittedAt) > Date.parse(newest) ? e.submittedAt : newest), items[0].submittedAt);
    const receipt = {
      key,
      items,
      total: items.reduce((sum, e) => sum + Number(e.amount || 0), 0),
      status: worstStatus(items),
      submittedAt,
    };
    const day = dayKey(submittedAt);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(receipt);
  }

  return [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([day, receipts]) => ({
      day,
      receipts: receipts.sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt)),
    }));
}

/** How many expenses are rejected and waiting for the Purchaser to fix. */
export function rejectedCount(expenses) {
  return (Array.isArray(expenses) ? expenses : []).filter((e) => e.status === "Rejected").length;
}
