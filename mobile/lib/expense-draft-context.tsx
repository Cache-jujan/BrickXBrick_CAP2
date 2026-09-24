import React, { createContext, useContext, useState, ReactNode } from "react";
import type { SelectedTicket, OcrResult } from "./expense-types";
import type { FileState } from "@/components/file-preview";

type Category = "Materials" | "Equipment" | "Other";
type ExpenseDraft = { ticket: SelectedTicket | null; file: FileState; ocrResult: OcrResult | null; category: Category | null; notes: string };
type Ctx = {
  draft: ExpenseDraft; setTicket: (t: SelectedTicket) => void; setFile: (f: FileState) => void;
  setOcrResult: (r: OcrResult) => void; setCategory: (c: Category) => void; setNotes: (n: string) => void; reset: () => void;
};

const EMPTY: ExpenseDraft = { ticket: null, file: null, ocrResult: null, category: null, notes: "" };
const ExpenseDraftContext = createContext<Ctx | null>(null);

export function ExpenseDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<ExpenseDraft>(EMPTY);
  return (
    <ExpenseDraftContext.Provider value={{
      draft,
      setTicket: (ticket) => setDraft((d) => ({ ...d, ticket })),
      setFile: (file) => setDraft((d) => ({ ...d, file })),
      setOcrResult: (ocrResult) => setDraft((d) => ({ ...d, ocrResult })),
      setCategory: (category) => setDraft((d) => ({ ...d, category })),
      setNotes: (notes) => setDraft((d) => ({ ...d, notes })),
      reset: () => setDraft(EMPTY),
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