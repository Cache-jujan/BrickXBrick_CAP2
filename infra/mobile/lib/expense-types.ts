export type SelectedTicket = { ticketId: string; projectId: string; projectName: string; subject: string; budget?: string };
export type LineItem = { id: string; name: string; quantity: string; price: string };
export type BackendLineItem = { description: string; amount: number; quantity: number | null; unitPrice: number | null };
export type OcrResult = {
  vendorName: string | null; tin: string | null; birNumber: string | null; birPermitNumber?: string | null;
  amount: number | string | null; receiptDate: string | null; lineItems?: BackendLineItem[];
  receiptImageURL?: string; ocrError?: string | null; [key: string]: any;
};