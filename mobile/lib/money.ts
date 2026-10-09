// Money and quantity helpers for the receipt screens.
// Same rule as the server: compare integer centavos and hundredths, never floats.

const TWO_DECIMALS = /^\d+(\.\d{1,2})?$/;

// "16,800.50" -> 1680050. Returns null when the text isn't a valid amount.
export function toCents(text: string): number | null {
  const clean = text.replace(/,/g, "").trim();
  if (!TWO_DECIMALS.test(clean)) return null;
  const [whole, fraction = ""] = clean.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

// "2.5" -> 250. 0 is allowed (fee, VAT, delivery lines).
export function toHundredths(text: string): number | null {
  return toCents(text);
}

// 1680050 -> "₱16,800.50"
export function formatPesoCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}₱${whole}.${String(abs % 100).padStart(2, "0")}`;
}

// "6100.00" (as the API returns DECIMAL) -> "₱6,100.00"
export function formatPeso(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  const cents = toCents(String(amount));
  return cents === null ? `₱${amount}` : formatPesoCents(cents);
}

// 20 -> "20", 2.5 -> "2.5"
export function formatQty(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(2)));
}
