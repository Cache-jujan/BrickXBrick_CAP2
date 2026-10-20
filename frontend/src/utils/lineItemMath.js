// lineItemMath.js — quantity, unit price and line amount move together.
//
// Handwritten receipts often leave the unit price blank, so it is derived from
// the row total: quantity 3, amount 300 -> 100 each. Everything is computed in
// whole centavos and hundredths, never with float multiplication.
//
//   edit amount      -> unit price = amount / quantity
//   edit unit price  -> amount     = quantity x unit price   (the user's price wins)
//   edit quantity    -> amount stays and the unit price follows, unless the user
//                       typed the unit price: then the amount follows it.
//
// Quantity 0 lines (delivery, VAT, fees) have no unit price.

/** Parse a nonnegative numeric field into centavos or quantity hundredths; return null if invalid. */
const toUnits = (value) => {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (text === "" || !Number.isFinite(Number(text)) || Number(text) < 0) return null;
  return Math.round(Number(text) * 100); // centavos, or hundredths for a quantity
};

/** Format integer centavos or hundredths as an ungrouped two-decimal string. */
const format = (cents) => (cents / 100).toFixed(2);

/** Derive unit price text from quantity and amount, or return an empty string if not derivable. */
export function derivedUnitPrice(quantity, amount) {
  const qtyH = toUnits(quantity);
  const cents = toUnits(amount);
  if (!qtyH || cents === null) return "";
  return format(Math.round((cents * 100) / qtyH));
}

/**
 * Return a copy of a line with an edited quantity, amount or unit price.
 * Amount edits derive the unit price; quantity edits preserve a manually entered
 * unit price and recalculate the amount, otherwise preserving the amount.
 */
export function editLine(item, field, value) {
  const next = { ...item, [field]: value };
  const qtyH = toUnits(next.quantity);

  if (field === "unitPrice") {
    next.unitEntered = String(value).trim() !== "";
    const unit = toUnits(value);
    if (qtyH && unit !== null) next.amount = format(Math.round((qtyH * unit) / 100));
    return next;
  }
  if (field === "amount") {
    next.unitEntered = false;
    next.unitPrice = derivedUnitPrice(next.quantity, value);
    return next;
  }
  if (field === "quantity") {
    const unit = next.unitEntered ? toUnits(next.unitPrice) : null;
    if (qtyH && unit !== null) next.amount = format(Math.round((qtyH * unit) / 100));
    else next.unitPrice = derivedUnitPrice(value, next.amount);
  }
  return next;
}

/** Keep a scanned unit price, deriving one from quantity and amount when the field is blank. */
export function withUnitPrice(item) {
  if (String(item.unitPrice ?? "").trim() !== "") return item;
  return { ...item, unitPrice: derivedUnitPrice(item.quantity, item.amount) };
}

/** Return a positive entered unit price, a derived price, or null when neither is available. */
export function unitPriceForPayload(item) {
  const typed = toUnits(item.unitPrice);
  if (typed !== null && typed > 0) return typed / 100;
  const derived = derivedUnitPrice(item.quantity, item.amount);
  return derived === "" ? null : Number(derived);
}
