// What is still missing on a receipt form, so the page can tag those fields and tell the person
// why Submit is greyed out. Pure.

const isNonNegative = (value) => value !== "" && value != null && Number.isFinite(Number(value)) && Number(value) >= 0;

/**
 * Line items: which boxes still need input.
 * `none`: no line has a description yet (the first row's description is what is missing).
 * `rows[i]`: { desc, amount, qty } booleans for row i. `numbers`: a described line lacks an amount or quantity.
 */
export function lineGaps(lineItems) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const none = !items.some((item) => String(item.description ?? "").trim());
  const rows = items.map((item, index) => {
    const named = String(item.description ?? "").trim() !== "";
    return {
      desc: none && index === 0,
      amount: named && !isNonNegative(item.amount),
      qty: named && !isNonNegative(item.quantity),
    };
  });
  return { none, rows, numbers: rows.some((row) => row.amount || row.qty) };
}
