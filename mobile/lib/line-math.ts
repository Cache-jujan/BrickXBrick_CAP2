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

// Unit price text for a quantity and a line amount, or "" when it can't be derived.
export function derivedUnitPrice(quantity: string, amount: string): string {
  const qtyH = toHundredths(quantity);
  const cents = toCents(amount);
  if (!qtyH || cents === null) return "";
  return formatAmountInput(Math.round((cents * 100) / qtyH));
}

const amountFrom = (qtyH: number, unitCents: number) => formatAmountInput(Math.round((qtyH * unitCents) / 100));

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

// A row that came from a scan: use the unit price it read, else derive one.
export function withUnitPrice<T extends LineMath>(row: T): T {
  if ((row.unitPrice ?? "").trim() !== "") return row;
  return { ...row, unitPrice: derivedUnitPrice(row.quantity, row.price) };
}

// The unit price to send: what is in the box, else derived, else null (fee rows).
export function unitPriceForPayload(row: LineMath): number | null {
  const typed = toCents(row.unitPrice ?? "");
  if (typed !== null && typed > 0) return typed / 100;
  const derived = derivedUnitPrice(row.quantity, row.price);
  return derived === "" ? null : toCents(derived)! / 100;
}
