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

const toUnits = (value) => {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (text === "" || !Number.isFinite(Number(text)) || Number(text) < 0) return null;
  return Math.round(Number(text) * 100); // centavos, or hundredths for a quantity
};

const format = (cents) => (cents / 100).toFixed(2);

// Unit price text for a quantity and a row total, or "" when it can't be derived.
export function derivedUnitPrice(quantity, amount) {
  const qtyH = toUnits(quantity);
  const cents = toUnits(amount);
  if (!qtyH || cents === null) return "";
  return format(Math.round((cents * 100) / qtyH));
}

// item: { quantity, amount, unitPrice, unitEntered } as strings. Returns a new item.
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

// A row that came from a scan: fill a blank unit price from the amount.
export function withUnitPrice(item) {
  if (String(item.unitPrice ?? "").trim() !== "") return item;
  return { ...item, unitPrice: derivedUnitPrice(item.quantity, item.amount) };
}

// The unit price to send: what is in the box, else derived, else null (fee lines).
export function unitPriceForPayload(item) {
  const typed = toUnits(item.unitPrice);
  if (typed !== null && typed > 0) return typed / 100;
  const derived = derivedUnitPrice(item.quantity, item.amount);
  return derived === "" ? null : Number(derived);
}
