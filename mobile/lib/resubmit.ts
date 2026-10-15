// Turns a Rejected expense from GET /api/expenses/mine into the draft the
// review screen edits, so the Purchaser can correct it and resubmit.

import type { FileState } from "@/components/file-preview";
import type { MyExpense } from "@/lib/api";
import type { OcrResult } from "@/lib/expense-types";
import { dateToIso } from "@/lib/receipt-checks";
import { phoneReachableUrl } from "@/lib/receipt-scans";

// The server sends the receipt date as a timestamp ("2026-10-08T16:00:00.000Z"
// for 9 Oct on a Manila-time server), because Postgres DATE is read as local
// midnight. Reading the day in the phone's own timezone gives back the date
// on the receipt. A plain "YYYY-MM-DD" is used as is.
export function receiptDateToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : dateToIso(parsed);
}

// The stored receipt, shown on the review screen next to the fields.
export function fileFromExpense(expense: MyExpense): NonNullable<FileState> {
  const uri = phoneReachableUrl(expense.receiptImageURL);
  if (/\.pdf$/i.test(uri)) return { type: "pdf", name: "Receipt.pdf", size: "", uri, mimeType: "application/pdf" };
  return { type: "image", name: "Receipt", uri, mimeType: /\.png$/i.test(uri) ? "image/png" : "image/jpeg" };
}

// No confidence or auto-fill hints: these values were already confirmed once.
export function ocrResultFromExpense(expense: MyExpense): OcrResult {
  return {
    vendorName: expense.vendorName,
    tin: expense.tin,
    birNumber: expense.birNumber,
    birPermitNumber: expense.birPermitNumber,
    amount: expense.amount,
    receiptDate: receiptDateToIso(expense.receiptDate),
    lineItems: expense.lineItems ?? [],
    receiptImageURL: expense.receiptImageURL,
  };
}
