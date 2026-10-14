import React, { createContext, useContext, useState, ReactNode } from "react";
import type { SelectedTicket, OcrResult } from "./expense-types";
import type { FileState } from "@/components/file-preview";

type Category = "Materials" | "Equipment" | "Other";
// "single": one receipt for one ticket (F6). "split": one receipt shared by
// several requests (F8); there is no ticket, the server decides the split.
export type DraftMode = "single" | "split";
// scanID: the background scan this draft came from, so it can be cleared
// from "Scanned receipts" once the expense is submitted.
// resubmit: set when the draft is a Rejected expense being corrected, so the
// last step updates that expense instead of creating a new one.
type Resubmit = { expenseID: string; reason: string | null };
type ExpenseDraft = {
  mode: DraftMode; ticket: SelectedTicket | null; file: FileState; ocrResult: OcrResult | null;
  category: Category | null; notes: string; scanID: string | null; resubmit: Resubmit | null;
};
// Everything needed to pick a scanned receipt back up (see lib/receipt-scans.ts).
type ResumeScan = { scanID: string; mode: DraftMode; ticket: SelectedTicket | null; file: FileState; ocrResult: OcrResult | null };
type ResubmitStart = Resubmit & { ticket: SelectedTicket | null; file: FileState; ocrResult: OcrResult; category: Category };
type Ctx = {
  draft: ExpenseDraft; setTicket: (t: SelectedTicket) => void; setFile: (f: FileState) => void;
  setOcrResult: (r: OcrResult) => void; setCategory: (c: Category) => void; setNotes: (n: string) => void; reset: () => void;
  startSplit: () => void; setScanID: (id: string | null) => void; resumeScan: (scan: ResumeScan) => void;
  startResubmit: (draft: ResubmitStart) => void;
};

const EMPTY: ExpenseDraft = { mode: "single", ticket: null, file: null, ocrResult: null, category: null, notes: "", scanID: null, resubmit: null };
const ExpenseDraftContext = createContext<Ctx | null>(null);

export function ExpenseDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<ExpenseDraft>(EMPTY);
  return (
    <ExpenseDraftContext.Provider value={{
      draft,
      setTicket: (ticket) => setDraft((d) => ({ ...d, mode: "single", ticket })),
      setFile: (file) => setDraft((d) => ({ ...d, file })),
      setOcrResult: (ocrResult) => setDraft((d) => ({ ...d, ocrResult })),
      setCategory: (category) => setDraft((d) => ({ ...d, category })),
      setNotes: (notes) => setDraft((d) => ({ ...d, notes })),
      reset: () => setDraft(EMPTY),
      // Fresh draft in split mode, with no ticket.
      startSplit: () => setDraft({ ...EMPTY, mode: "split" }),
      setScanID: (scanID) => setDraft((d) => ({ ...d, scanID })),
      // Replaces the whole draft: a resumed scan never mixes with the old one.
      resumeScan: ({ scanID, mode, ticket, file, ocrResult }) => setDraft({ ...EMPTY, scanID, mode, ticket, file, ocrResult }),
      // A Rejected expense, loaded for correction (always a single-ticket receipt).
      startResubmit: ({ expenseID, reason, ticket, file, ocrResult, category }) =>
        setDraft({ ...EMPTY, mode: "single", ticket, file, ocrResult, category, resubmit: { expenseID, reason } }),
    }}>
      {children}
    </ExpenseDraftContext.Provider>
  );
}

export function useExpenseDraft() {
  const ctx = useContext(ExpenseDraftContext);
  if (!ctx) throw new Error("useExpenseDraft must be used within ExpenseDraftProvider");
  return ctx;
}
