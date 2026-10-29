import { useEffect, useMemo, useRef, useState } from "react";
import { submitExpense } from "../../api/expensesApi";
import { listExpenseLinkableTickets } from "../../api/ticketsApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useReceiptScans, useOpenWantedScan } from "../../context/ReceiptScanContext";
import { ReceiptScanTray } from "../../components/expenses/ReceiptScanTray";
import { ExpenseModeBar } from "../../components/expenses/ExpenseModeBar";
import { ReceiptCapture } from "../../components/expenses/ReceiptCapture";
import { TaxDetails } from "../../components/expenses/TaxDetails";
import { SubmitBlockers } from "../../components/expenses/SubmitBlockers";
import { lineGaps } from "../../utils/formGaps";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { SearchableSelect } from "../../components/ui/SearchableSelect";
import { LoadingOverlay } from "../../components/ui/LoadingOverlay";
import { editLine, withUnitPrice, unitPriceForPayload } from "../../utils/lineItemMath";
import "./SubmitExpensePage.css";
import { useLocale } from "../../i18n/LocaleProvider";

export const EMPTY_DRAFT = {
  vendorName: "",
  amount: "",
  receiptDate: "",
  category: "Materials",
  tin: "",
  birPermitType: "",
  birPermitNumber: "",
  birNumber: "",
  receiptImageURL: "",
  lineItems: [{ description: "", amount: "", quantity: "", unitPrice: "" }],
};

function toDateInput(value) {
  if (!value) return "";
  const text = String(value);
  const isoDate = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

/** Convert scanned receipt fields into editable strings, filling missing unit prices and line rows. */
export function draftFromScan(result) {
  const extractedItems = Array.isArray(result.lineItems)
    ? result.lineItems.map((item) => withUnitPrice({
        description: item.description || "",
        amount: item.amount == null ? "" : String(item.amount),
        quantity: item.quantity == null ? "" : String(item.quantity),
        unitPrice: item.unitPrice == null ? "" : String(item.unitPrice),
      }))
    : [];

  return {
    vendorName: result.vendorName || "",
    amount: result.amount == null ? "" : String(result.amount),
    receiptDate: toDateInput(result.receiptDate),
    category: "Materials",
    tin: result.tin || "",
    birPermitType: result.birPermitType || "",
    birPermitNumber: result.birPermitNumber || "",
    birNumber: result.birNumber || "",
    receiptImageURL: result.receiptImageURL || "",
    lineItems: extractedItems.length
      ? extractedItems
      : [{
          description: "Receipt items — review",
          amount: result.amount == null ? "" : String(result.amount),
          quantity: "",
          unitPrice: "",
        }],
  };
}

/** Accept a JPEG, PNG or PDF MIME type or extension for client-side receipt selection. */
export function isSupportedReceipt(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return ["image/jpeg", "image/jpg", "image/png", "application/pdf"].includes(file.type)
    || ["jpg", "jpeg", "png", "pdf"].includes(extension);
}

/** Render the managers' receipt capture and expense submission flow for resolved tickets. */
export function SubmitExpensePage() {
  const { user } = useAuth();
  const { t, tv } = useLocale();

  const [tickets, setTickets] = useState([]);
  const [selectedTicketId, setSelectedTicketId] = useState("");
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [receiptName, setReceiptName] = useState("");
  const [loadingTickets, setLoadingTickets] = useState(true);
  // Only the short upload is waited for; reading the receipt happens in the background.
  const [uploading, setUploading] = useState(false);
  // The scan whose result is in the form now (removed from the tray once submitted).
  const [activeScanID, setActiveScanID] = useState("");
  // The tax fields are folded away; the user can open them.
  const [taxOpen, setTaxOpen] = useState(false);
  const { startScan, dismissScan } = useReceiptScans();
  const [submitting, setSubmitting] = useState(false);
  const [pageError, setPageError] = useState("");
  const [pageNotice, setPageNotice] = useState("");
  const [ocrNotice, setOcrNotice] = useState("");
  // From the vendor master list: fields it filled, and OCR readings it overrode.
  const [vendorInfo, setVendorInfo] = useState({ autoFilled: [], conflicts: [] });
  // State updates are async, so a fast double-click can run handleSubmit
  // twice before `submitting` re-renders. The ref blocks the second call.
  const busyRef = useRef(false);

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.ticketID === selectedTicketId) || null,
    [tickets, selectedTicketId]
  );

  useEffect(() => {
    let active = true;
    async function loadTickets() {
      setLoadingTickets(true);
      setPageError("");
      try {
        const rows = await listExpenseLinkableTickets();
        if (active) setTickets(Array.isArray(rows) ? rows : []);
      } catch (error) {
        if (active) setPageError(extractErrorMessage(error, t("errors.load_tickets")));
      } finally {
        if (active) setLoadingTickets(false);
      }
    }
    loadTickets();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once; a language change must not refetch
  }, []);

  function setField(name, value) {
    setDraft((current) => ({ ...current, [name]: value }));
  }

  // Picking a file only uploads it and puts it in the tray; the form you are working on stays
  // as it is, so more receipts can be added while earlier ones are still being read.
  async function handleReceiptPick(file) {
    if (!file || uploading) return;

    setPageError("");
    if (!isSupportedReceipt(file)) {
      setPageError(t("errors.receipt_type"));
      return;
    }
    setUploading(true);
    try {
      await startScan(file, "submit");
    } catch (error) {
      setPageError(extractErrorMessage(error, t("errors.upload_failed")));
    } finally {
      setUploading(false);
    }
  }

  /** Load a scan from the tray into the form: its draft when it was read, or just the photo when it could not be. */
  function openScan(scan) {
    setPageError("");
    setPageNotice("");
    setReceiptName(scan.context?.fileName || "");
    setActiveScanID(scan.scanID);
    if (scan.status === "Ready" && scan.result) {
      const result = scan.result;
      setDraft(draftFromScan({ ...result, receiptImageURL: result.receiptImageURL || scan.receiptImageURL }));
      setVendorInfo({
        autoFilled: Array.isArray(result.autoFilled) ? result.autoFilled : [],
        conflicts: Array.isArray(result.vendorConflicts) ? result.vendorConflicts : [],
      });
      setOcrNotice(result.ocrError || (result.confidence === "low" ? t("submit.ocr_low") : ""));
    } else {
      // Could not be read: the photo is already stored, so the details are typed in by hand.
      setDraft({ ...EMPTY_DRAFT, receiptImageURL: scan.receiptImageURL, lineItems: [{ ...EMPTY_DRAFT.lineItems[0] }] });
      setVendorInfo({ autoFilled: [], conflicts: [] });
      setOcrNotice(t("scan.manual_notice"));
    }
  }

  // Arriving from the "receipt ready" pop-up or the bell (?scan=<id>).
  useOpenWantedScan("submit", openScan);

  function handleTicketChange(ticketID) {
    setSelectedTicketId(ticketID);
    if (ticketID) setField("category", "Materials");
  }

  /** Edit one receipt line, keeping its quantity, unit price and amount synchronized. */
  function updateLineItem(index, name, value) {
    setDraft((current) => ({
      ...current,
      lineItems: current.lineItems.map((item, itemIndex) =>
        itemIndex === index
          ? (["quantity", "unitPrice", "amount"].includes(name) ? editLine(item, name, value) : { ...item, [name]: value })
          : item
      ),
    }));
  }

  function addLineItem() {
    setDraft((current) => ({
      ...current,
      lineItems: [...current.lineItems, { description: "", amount: "", quantity: "", unitPrice: "" }],
    }));
  }

  function removeLineItem(index) {
    setDraft((current) => ({
      ...current,
      lineItems: current.lineItems.length <= 1
        ? current.lineItems
        : current.lineItems.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  // Every line needs a quantity (0 for delivery, VAT, fees). A missing
  // quantity used to count as 1 on the server, which made Layer 3 flag fees.
  const isNonNegativeNumber = (value) => value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
  const namedLineItems = draft.lineItems.filter((item) => item.description.trim());
  const validLineItems = namedLineItems.filter((item) =>
    isNonNegativeNumber(item.amount) && isNonNegativeNumber(item.quantity)
  );
  const allLinesValid = namedLineItems.length > 0 && validLineItems.length === namedLineItems.length;
  const amountIsValid = draft.amount !== ""
    && Number.isFinite(Number(draft.amount))
    && Number(draft.amount) >= 0;
  const canSubmit = Boolean(
    selectedTicket
      && draft.receiptImageURL
      && draft.vendorName.trim()
      && amountIsValid
      && draft.receiptDate
      && draft.category
      && allLinesValid
      && !loadingTickets
      && !uploading
      && !submitting
  );

  // What is still missing: tags on those boxes, and the reason shown beside the greyed-out button.
  const gapOfLines = lineGaps(draft.lineItems);
  const missing = {
    ticket: !selectedTicket,
    vendor: !draft.vendorName.trim(),
    amount: !amountIsValid,
    date: !draft.receiptDate,
  };
  const gaps = [
    !draft.receiptImageURL && t("gap.receipt"),
    missing.ticket && t("submit.ticket_label"),
    missing.vendor && t("submit.vendor_name"),
    missing.amount && t("submit.receipt_total"),
    missing.date && t("my_expenses.receipt_date"),
    gapOfLines.none && t("gap.line_item"),
    gapOfLines.numbers && t("gap.line_numbers"),
  ].filter(Boolean);

  /** Validate and submit the ticket-linked receipt once, clearing the draft after success. */
  async function handleSubmit(event) {
    event.preventDefault();
    if (busyRef.current) return;
    setPageError("");
    setPageNotice("");
    if (!selectedTicket || !draft.receiptImageURL || !canSubmit) {
      setPageError(t("errors.submit_incomplete"));
      return;
    }

    busyRef.current = true;
    setSubmitting(true);
    try {
      const payload = {
        ticketID: selectedTicket.ticketID,
        projectID: selectedTicket.projectID,
        vendorName: draft.vendorName.trim(),
        amount: Number(draft.amount),
        receiptDate: draft.receiptDate,
        category: draft.category,
        receiptImageURL: draft.receiptImageURL,
        tin: draft.tin.trim() || null,
        birPermitNumber: draft.birPermitNumber.trim() || null,
        birNumber: draft.birNumber.trim() || null,
        lineItems: validLineItems.map((item) => ({
          description: item.description.trim(),
          amount: Number(item.amount),
          quantity: Number(item.quantity),
          unitPrice: unitPriceForPayload(item),
        })),
      };
      const expense = await submitExpense(payload);
      setPageNotice(expense.expenseID ? t("submit.saved_pending_id", { id: expense.expenseID }) : t("submit.saved_pending"));
      if (activeScanID) { dismissScan(activeScanID); setActiveScanID(""); } // this receipt is done: take it off the tray
      setDraft({ ...EMPTY_DRAFT, lineItems: [{ ...EMPTY_DRAFT.lineItems[0] }] });
      setSelectedTicketId("");
      setReceiptName("");
      setOcrNotice("");
      setVendorInfo({ autoFilled: [], conflicts: [] });
    } catch (error) {
      // Keep the draft so the user can fix the problem and retry.
      setPageError(extractErrorMessage(error, t("errors.submit_failed")));
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  }

  const vendorLabel = (label, field) =>
    vendorInfo.autoFilled.includes(field) ? t("submit.from_vendor_list", { label }) : label;
  const vendorFieldLabel = (field) =>
    ({ tin: "TIN", birPermitType: t("submit.field_bir_type"), birPermitNumber: t("submit.field_bir_permit") })[field] || field;

  if (!user || !["General Manager", "Project Manager"].includes(user.role)) {
    return <Banner tone="error" title={t("auth.not_authorized_title")}>{t("submit.not_authorized_body")}</Banner>;
  }

  return (
    <div className="submit-expense-page" data-mode="submit">
      <LoadingOverlay open={submitting} message={t("submit.submitting")} detail={t("submit.dont_close")} />
      <ExpenseModeBar mode="submit" />

      {pageError && <Banner tone="error" title={t("submit.could_not_continue")}>{pageError}</Banner>}
      {pageNotice && <Banner tone="info" title={t("submit.saved_title")}>{pageNotice}</Banner>}
      {ocrNotice && <Banner tone="warning" title={t("submit.review_carefully")}>{ocrNotice}</Banner>}
      {vendorInfo.conflicts.length > 0 && (
        <Banner tone="warning" title={t("submit.conflict_title")}>
          {vendorInfo.conflicts.map((c) => t("submit.conflict", { field: vendorFieldLabel(c.field), ocr: c.ocrValue, master: c.masterValue })).join(" · ")}.
          {" "}{t("submit.vendor_used")}
        </Banner>
      )}

      <form className="xp-layout" onSubmit={handleSubmit}>
        <Card className="submit-expense-card xp-receipt">
          <section className="submit-expense-section" aria-labelledby="receipt-source-heading">
            <div className="submit-expense-section-heading">
              <div>
                <h2 id="receipt-source-heading">{t("submit.step1_title")}</h2>
                <p>{t("submit.step1_help")}</p>
              </div>
              {receiptName && <span className="submit-expense-filename">{receiptName}</span>}
            </div>

            <ReceiptCapture onFile={handleReceiptPick} disabled={uploading} uploading={uploading} />

            <ReceiptScanTray mode="submit" activeScanID={activeScanID} onOpen={openScan} />

            {draft.receiptImageURL && (
              <div className="submit-expense-receipt-preview">
                {receiptName.toLowerCase().endsWith(".pdf") ? (
                  <iframe
                    className="submit-expense-pdf-preview"
                    title={t("submit.pdf_preview_title")}
                    src={draft.receiptImageURL}
                  />
                ) : (
                  <img
                    className="submit-expense-image-preview"
                    src={draft.receiptImageURL}
                    alt={t("submit.image_preview_alt")}
                  />
                )}
                <a className="submit-expense-receipt-link" href={draft.receiptImageURL} target="_blank" rel="noreferrer">
                  {t("submit.open_receipt")}
                </a>
              </div>
            )}
          </section>
        </Card>

        <Card className="submit-expense-card xp-details">
          <section className="submit-expense-section" aria-labelledby="ticket-heading">
            <div className="submit-expense-section-heading">
              <div>
                <h2 id="ticket-heading">{t("submit.step2_title")}</h2>
                <p>{t("submit.step2_help")}</p>
              </div>
            </div>

            <SearchableSelect
              label={t("submit.ticket_label")}
              required
              missing={missing.ticket}
              missingText={t("gap.needed")}
              value={selectedTicketId}
              onChange={handleTicketChange}
              disabled={loadingTickets || tickets.length === 0}
              options={[
                { value: "", label: loadingTickets ? t("submit.loading_tickets") : t("submit.choose_ticket"), pinned: true },
                ...tickets.map((ticket) => ({
                  value: ticket.ticketID,
                  label: `${ticket.projectName} — ${ticket.subject} (${ticket.vendorName || t("submit.vendor_not_specified")})`,
                  searchText: ticket.materialType ?? "",
                })),
              ]}
              placeholder={loadingTickets ? t("submit.loading_tickets") : t("submit.choose_ticket")}
              searchPlaceholder={t("ss.search_ph")}
              noMatchText={t("ss.no_match", { query: "{query}" })}
            />
            {selectedTicket && (
              <div className="submit-expense-ticket-context">
                <strong>{selectedTicket.projectName}</strong>
                <span>{selectedTicket.materialType || t("submit.material_request")}</span>
                {selectedTicket.quantity != null && <span>{t("submit.requested_quantity", { quantity: selectedTicket.quantity })}</span>}
              </div>
            )}
            {!loadingTickets && tickets.length === 0 && !pageError && (
              <Banner tone="info" title={t("submit.no_tickets_title")}>{t("submit.no_tickets_body")}</Banner>
            )}
          </section>

          <section className="submit-expense-section xp-section-next" aria-labelledby="review-heading">
            <div className="submit-expense-section-heading">
              <div>
                <h2 id="review-heading">{t("submit.step3_title")}</h2>
                <p>{t("submit.step3_help")}</p>
              </div>
            </div>

            <div className={`submit-expense-fields xp-main-fields`}>
              <Field label={t("submit.vendor_name")} required missing={missing.vendor} value={draft.vendorName} onChange={(event) => setField("vendorName", event.target.value)} />
              <Field label={t("submit.receipt_total")} required missing={missing.amount} type="number" min="0" step="0.01" value={draft.amount} onChange={(event) => setField("amount", event.target.value)} />
              <Field label={t("my_expenses.receipt_date")} required missing={missing.date} type="date" value={draft.receiptDate} onChange={(event) => setField("receiptDate", event.target.value)} />
              <Field as="select" label={t("submit.expense_category")} required value={draft.category} onChange={(event) => setField("category", event.target.value)}>
                <option value="Materials">{tv("category", "Materials")}</option>
                <option value="Equipment">{tv("category", "Equipment")}</option>
                <option value="Other">{tv("category", "Other")}</option>
              </Field>
            </div>

            <TaxDetails open={taxOpen} onToggle={setTaxOpen} filled={Boolean(draft.tin || draft.birPermitNumber || draft.birNumber || draft.birPermitType)}>
              <Field label={vendorLabel("TIN", "tin")} value={draft.tin} onChange={(event) => setField("tin", event.target.value)} />
              <Field label={vendorLabel(t("submit.field_bir_permit"), "birPermitNumber")} value={draft.birPermitNumber} onChange={(event) => setField("birPermitNumber", event.target.value)} />
              <Field label="OR / SI number" value={draft.birNumber} onChange={(event) => setField("birNumber", event.target.value)} />
            </TaxDetails>

            <div className="submit-expense-items-heading">
              <div>
                <h3>{t("submit.line_items_title")}</h3>
                <p>{t("submit.line_items_help")}</p>
              </div>
              <Button type="button" variant="secondary" onClick={addLineItem}>{t("common.add_item")}</Button>
            </div>
            <div className="submit-expense-items">
              {draft.lineItems.map((item, index) => (
                <div className="submit-expense-item-row" key={`item-${index}`}>
                  <Field label={t("submit.item_n", { n: index + 1 })} required missing={gapOfLines.rows[index]?.desc} value={item.description} onChange={(event) => updateLineItem(index, "description", event.target.value)} placeholder={t("submit.description")} />
                  <Field label={t("submit.item_amount")} required missing={gapOfLines.rows[index]?.amount} type="number" min="0" step="0.01" value={item.amount} onChange={(event) => updateLineItem(index, "amount", event.target.value)} />
                  <Field label={t("split.quantity_fees")} required missing={gapOfLines.rows[index]?.qty} type="number" min="0" step="0.01" value={item.quantity} onChange={(event) => updateLineItem(index, "quantity", event.target.value)} />
                  <Field label={t("submit.unit_price")} type="number" min="0" step="0.01" placeholder={t("submit.calculated")} value={item.unitPrice} onChange={(event) => updateLineItem(index, "unitPrice", event.target.value)} />
                  <Button type="button" variant="ghost" className="submit-expense-remove-item" onClick={() => removeLineItem(index)} disabled={draft.lineItems.length <= 1} aria-label={t("submit.remove_item_n", { n: index + 1 })}>{t("common.remove")}</Button>
                </div>
              ))}
            </div>
          </section>
        </Card>

        <div className="submit-expense-footer xp-footer">
          <SubmitBlockers gaps={gaps} note={t("submit.footer_note")} />
          <Button type="submit" disabled={!canSubmit}>{submitting ? t("common.submitting") : t("nav.submit_expense")}</Button>
        </div>
      </form>
    </div>
  );
}
