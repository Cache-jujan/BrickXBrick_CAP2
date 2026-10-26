// Helpers for a money text box: the form keeps a plain numeric string ("1234567.5"),
// the box shows it with thousands commas ("1,234,567.5").

// What the user typed -> the plain numeric string to keep (digits and one dot, 2 decimals).
export function parseAmountInput(text) {
  const cleaned = String(text).replace(/[^0-9.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned;
  return `${cleaned.slice(0, dot)}.${cleaned.slice(dot + 1).replace(/\./g, "").slice(0, 2)}`;
}

// The plain numeric string -> what the box shows.
export function formatAmountInput(raw) {
  if (raw === "" || raw == null) return "";
  const [int, dec] = String(raw).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec === undefined ? grouped : `${grouped}.${dec}`;
}
