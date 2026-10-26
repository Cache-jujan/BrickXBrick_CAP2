export type SelectedTicket = { ticketId: string; projectId: string; projectName: string; subject: string; budget?: string };
// ocr: how sure the scan was about a row it filled in; cleared once the user edits the row.
// scanned: the name the scan read, kept so a renamed row can show the receipt's own text. Never sent.
// price is the line amount. unitPrice is typed or derived (amount / quantity); unitEntered marks one the user typed.
export type LineItem = { id: string; name: string; quantity: string; price: string; unitPrice?: string; unitEntered?: boolean; ocr?: "medium" | "low"; bomItemID?: string | null; matchedTicketID?: string | null; scanned?: string };
export type BackendLineItem = { description: string; amount: number; quantity: number | null; unitPrice: number | null; bomItemID?: string | null; matchedTicketID?: string | null };
export type OcrResult = {
  vendorName: string | null; tin: string | null; birNumber: string | null; birPermitType?: string | null; birPermitNumber?: string | null;
  amount: number | string | null; receiptDate: string | null; lineItems?: BackendLineItem[];
  receiptImageURL?: string; ocrError?: string | null;
  // From POST /receipts/scan. confidence keys: vendorName, date, amount, tin, birPermitNumber, orSiNumber.
  confidence?: Partial<Record<string, "high" | "medium" | "low">>;
  birValidationStatus?: "Formal-Tax-Deductible" | "Informal";
  missingBirFields?: string[];
  // Vendor-list auto-fill: fields it filled, and OCR readings it overrode.
  autoFilled?: string[];
  vendorConflicts?: { field: string; ocrValue: string; masterValue: string }[];
  [key: string]: any;
};
