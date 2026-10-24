import { useEffect, useMemo, useRef, useState } from "react";
import { scanReceipt, submitExpense } from "../../api/expensesApi";
import { listExpenseLinkableTickets } from "../../api/ticketsApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { LoadingOverlay } from "../../components/ui/LoadingOverlay";
import { editLine, withUnitPrice, unitPriceForPayload } from "../../utils/lineItemMath";
import "./SubmitExpensePage.css";
import { BackLink } from "../../components/ui/BackLink";
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
  const cameraInput = useRef(null);
  const imageInput = useRef(null);
  const pdfInput = useRef(null);

  const [tickets, setTickets] = useState([]);
  const [selectedTicketId, setSelectedTicketId] = useState("");
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [receiptName, setReceiptName] = useState("");
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [scanning, setScanning] = useState(false);
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

  async function handleReceiptPick(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busyRef.current) return;

    setPageError("");
    setPageNotice("");
    setOcrNotice("");
    setReceiptName("");
    setVendorInfo({ autoFilled: [], conflicts: [] });
    setDraft({ ...EMPTY_DRAFT, lineItems: [{ ...EMPTY_DRAFT.lineItems[0] }] });
    if (!isSupportedReceipt(file)) {
      setPageError(t("errors.receipt_type"));
      return;
    }

    setReceiptName(file.name);
    busyRef.current = true;
    setScanning(true);
    try {
      const result = await scanReceipt(file);
      setDraft(draftFromScan(result));
      setVendorInfo({
        autoFilled: Array.isArray(result.autoFilled) ? result.autoFilled : [],
        conflicts: Array.isArray(result.vendorConflicts) ? result.vendorConflicts : [],
      });
      setOcrNotice(result.ocrError || "");
      if (!result.ocrError && result.confidence === "low") {
        setOcrNotice(t("submit.ocr_low"));
      }
    } catch (error) {
      setPageError(extractErrorMessage(error, t("errors.upload_failed")));
    } finally {
      busyRef.current = false;
      setScanning(false);
    }
  }

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
      && !scanning
      && !submitting
  );

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
    <div className="submit-expense-page">
      <LoadingOverlay
        open={scanning || submitting}
        message={scanning ? t("submit.reading") : t("submit.submitting")}
        detail={scanning ? t("submit.scan_detail") : t("submit.dont_close")}
      />
      <div className="submit-expense-header">
        <div>
          <BackLink to="/expenses">{t("submit.back")}</BackLink>
          <h1>{t("nav.submit_expense")}</h1>
          <p className="submit-expense-subtitle">{t("submit.subtitle")}</p>
        </div>
        <span className="submit-expense-role">{user.role}</span>
      </div>

      {pageError && <Banner tone="error" title={t("submit.could_not_continue")}>{pageError}</Banner>}
      {pageNotice && <Banner tone="info" title={t("submit.saved_title")}>{pageNotice}</Banner>}
      {ocrNotice && <Banner tone="warning" title={t("submit.review_carefully")}>{ocrNotice}</Banner>}
      {vendorInfo.conflicts.length > 0 && (
        <Banner tone="warning" title={t("submit.conflict_title")}>
          {vendorInfo.conflicts.map((c) => t("submit.conflict", { field: vendorFieldLabel(c.field), ocr: c.ocrValue, master: c.masterValue })).join(" · ")}.
          {" "}{t("submit.vendor_used")}
        </Banner>
      )}

      <form className="submit-expense-form" onSubmit={handleSubmit}>
        <Card className="submit-expense-card">
          <section className="submit-expense-section" aria-labelledby="receipt-source-heading">
            <div className="submit-expense-section-heading">
              <div>
                <h2 id="receipt-source-heading">{t("submit.step1_title")}</h2>
                <p>{t("submit.step1_help")}</p>
              </div>
              {receiptName && <span className="submit-expense-filename">{receiptName}</span>}
            </div>

            <input ref={cameraInput} className="submit-expense-hidden-input" type="file" accept="image/jpeg,image/png" capture="environment" onChange={handleReceiptPick} />
            <input ref={imageInput} className="submit-expense-hidden-input" type="file" accept="image/jpeg,image/png" onChange={handleReceiptPick} />
            <input ref={pdfInput} className="submit-expense-hidden-input" type="file" accept="application/pdf,.pdf" onChange={handleReceiptPick} />

            <div className="submit-expense-upload-actions">
              <Button type="button" onClick={() => cameraInput.current?.click()} disabled={scanning}>{t("submit.capture_camera")}</Button>
              <Button type="button" variant="secondary" onClick={() => imageInput.current?.click()} disabled={scanning}>{t("submit.choose_image")}</Button>
              <Button type="button" variant="secondary" onClick={() => pdfInput.current?.click()} disabled={scanning}>{t("submit.choose_pdf")}</Button>
              {scanning && <span className="submit-expense-progress" role="status">{t("submit.uploading_scanning")}</span>}
            </div>

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

        <Card className="submit-expense-card">
          <section className="submit-expense-section" aria-labelledby="ticket-heading">
            <div className="submit-expense-section-heading">
              <div>
                <h2 id="ticket-heading">{t("submit.step2_title")}</h2>
                <p>{t("submit.step2_help")}</p>
              </div>
            </div>

            <Field
              as="select"
              label={t("submit.ticket_label")}
              required
              value={selectedTicketId}
              onChange={(event) => handleTicketChange(event.target.value)}
              disabled={loadingTickets || tickets.length === 0}
            >
              <option value="">{loadingTickets ? t("submit.loading_tickets") : t("submit.choose_ticket")}</option>
              {tickets.map((ticket) => (
                <option key={ticket.ticketID} value={ticket.ticketID}>
                  {ticket.projectName} — {ticket.subject} ({ticket.vendorName || t("submit.vendor_not_specified")})
                </option>
              ))}
            </Field>
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
        </Card>

        <Card className="submit-expense-card">
          <section className="submit-expense-section" aria-labelledby="review-heading">
            <div className="submit-expense-section-heading">
              <div>
                <h2 id="review-heading">{t("submit.step3_title")}</h2>
                <p>{t("submit.step3_help")}</p>
              </div>
            </div>

            <div className="submit-expense-fields">
              <Field label={t("submit.vendor_name")} required value={draft.vendorName} onChange={(event) => setField("vendorName", event.target.value)} />
              <Field label={t("submit.receipt_total")} required type="number" min="0" step="0.01" value={draft.amount} onChange={(event) => setField("amount", event.target.value)} />
              <Field label={t("my_expenses.receipt_date")} required type="date" value={draft.receiptDate} onChange={(event) => setField("receiptDate", event.target.value)} />
              <Field as="select" label={t("submit.expense_category")} required value={draft.category} onChange={(event) => setField("category", event.target.value)}>
                <option value="Materials">{tv("category", "Materials")}</option>
                <option value="Equipment">{tv("category", "Equipment")}</option>
                <option value="Other">{tv("category", "Other")}</option>
              </Field>
              <Field label={vendorLabel("TIN", "tin")} value={draft.tin} onChange={(event) => setField("tin", event.target.value)} />
              <Field label={vendorLabel(t("submit.field_bir_type"), "birPermitType")} value={draft.birPermitType} onChange={(event) => setField("birPermitType", event.target.value)} placeholder="Permit, PTU, or ATP" />
              <Field label={vendorLabel(t("submit.field_bir_permit"), "birPermitNumber")} value={draft.birPermitNumber} onChange={(event) => setField("birPermitNumber", event.target.value)} />
              <Field label="OR / SI number" value={draft.birNumber} onChange={(event) => setField("birNumber", event.target.value)} />
            </div>

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
                  <Field label={t("submit.item_n", { n: index + 1 })} required value={item.description} onChange={(event) => updateLineItem(index, "description", event.target.value)} placeholder={t("submit.description")} />
                  <Field label={t("submit.item_amount")} required type="number" min="0" step="0.01" value={item.amount} onChange={(event) => updateLineItem(index, "amount", event.target.value)} />
                  <Field label={t("submit.quantity_help")} required type="number" min="0" step="0.01" value={item.quantity} onChange={(event) => updateLineItem(index, "quantity", event.target.value)} />
                  <Field label={t("submit.unit_price")} type="number" min="0" step="0.01" placeholder={t("submit.calculated")} value={item.unitPrice} onChange={(event) => updateLineItem(index, "unitPrice", event.target.value)} />
                  <Button type="button" variant="ghost" className="submit-expense-remove-item" onClick={() => removeLineItem(index)} disabled={draft.lineItems.length <= 1} aria-label={t("submit.remove_item_n", { n: index + 1 })}>{t("common.remove")}</Button>
                </div>
              ))}
            </div>
          </section>
        </Card>

        <div className="submit-expense-footer">
          <p>{t("submit.footer_note")}</p>
          <Button type="submit" disabled={!canSubmit}>{submitting ? t("common.submitting") : t("nav.submit_expense")}</Button>
        </div>
      </form>
    </div>
  );
}
