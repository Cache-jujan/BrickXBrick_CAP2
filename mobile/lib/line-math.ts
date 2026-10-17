// Quantity, unit price and line amount move together on the review screen.
//
// Handwritten receipts often leave the unit price blank, so it is derived from
// the row total: quantity 3, amount 300 -> 100 each. Integer centavos and
// hundredths only (see money.ts), never float multiplication.
//
//   edit amount      -> unit price = amount / quantity
//   edit unit price  -> amount     = quantity x unit price   (the typed price wins)
//   edit quantity    -> amount stays and the unit price follows, unless the user
//                       typed the unit price: then the amount follows it.
//
// Quantity 0 rows (delivery, VAT, fees) have no unit price.

import { formatAmountInput, toCents, toHundredths } from "@/lib/money";

// `price` is the LINE AMOUNT (the review screen's historical name for it).
export type LineMath = { quantity: string; price: string; unitPrice?: string; unitEntered?: boolean };

/** Derive unit price text from quantity and line amount, or return an empty string if unavailable. */
export function derivedUnitPrice(quantity: string, amount: string): string {
  const qtyH = toHundredths(quantity);
  const cents = toCents(amount);
  if (!qtyH || cents === null) return "";
  return formatAmountInput(Math.round((cents * 100) / qtyH));
}

/** Multiply quantity hundredths by unit centavos and format the rounded line amount. */
const amountFrom = (qtyH: number, unitCents: number) => formatAmountInput(Math.round((qtyH * unitCents) / 100));

/**
 * Return an edited row with quantity, unit price and line amount (`price`) synchronized.
 * Amount edits derive the unit price; quantity edits preserve a manually entered
 * unit price and recalculate the amount, otherwise preserving the amount.
 */
export function editLine<T extends LineMath>(row: T, field: "quantity" | "price" | "unitPrice", value: string): T {
  const next: T = { ...row, [field]: value };
  const qtyH = toHundredths(next.quantity);

  if (field === "unitPrice") {
    next.unitEntered = value.trim() !== "";
    const unit = toCents(value);
    if (qtyH && unit !== null) next.price = amountFrom(qtyH, unit);
    return next;
  }
  if (field === "price") {
    next.unitEntered = false;
    next.unitPrice = derivedUnitPrice(next.quantity, value);
    return next;
  }
  const unit = next.unitEntered ? toCents(next.unitPrice ?? "") : null;
  if (qtyH && unit !== null) next.price = amountFrom(qtyH, unit);
  else next.unitPrice = derivedUnitPrice(value, next.price);
  return next;
}

/** Keep a scanned unit price, deriving one from quantity and line amount when blank. */
export function withUnitPrice<T extends LineMath>(row: T): T {
  if ((row.unitPrice ?? "").trim() !== "") return row;
  return { ...row, unitPrice: derivedUnitPrice(row.quantity, row.price) };
}

/** Return a positive entered unit price, a derived price, or null when neither is available. */
export function unitPriceForPayload(row: LineMath): number | null {
  const typed = toCents(row.unitPrice ?? "");
  if (typed !== null && typed > 0) return typed / 100;
  const derived = derivedUnitPrice(row.quantity, row.price);
  return derived === "" ? null : toCents(derived)! / 100;
}
