export type SelectedTicket = { ticketId: string; projectId: string; projectName: string; subject: string; budget?: string };
export type LineItem = { id: string; name: string; quantity: string; price: string };
export type BackendLineItem = { description: string; amount: number; quantity: number | null; unitPrice: number | null };
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
