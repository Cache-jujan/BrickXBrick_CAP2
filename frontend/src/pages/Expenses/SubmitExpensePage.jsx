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
import "./SubmitExpensePage.css";
import { BackLink } from "../../components/ui/BackLink";

const EMPTY_DRAFT = {
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

const VENDOR_FIELD_LABELS = { tin: "TIN", birPermitType: "BIR authority type", birPermitNumber: "BIR permit number" };

function toDateInput(value) {
  if (!value) return "";
  const text = String(value);
  const isoDate = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function draftFromScan(result) {
  const extractedItems = Array.isArray(result.lineItems)
    ? result.lineItems.map((item) => ({
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

function isSupportedReceipt(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return ["image/jpeg", "image/jpg", "image/png", "application/pdf"].includes(file.type)
    || ["jpg", "jpeg", "png", "pdf"].includes(extension);
}

export function SubmitExpensePage() {
  const { user } = useAuth();
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
        if (active) setPageError(extractErrorMessage(error, "Couldn't load resolved procurement tickets."));
      } finally {
        if (active) setLoadingTickets(false);
      }
    }
    loadTickets();
    return () => { active = false; };
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
      setPageError("Choose a JPG, PNG, or PDF receipt. HEIC and other formats are not accepted yet.");
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
        setOcrNotice("OCR confidence is low. Check every extracted value before submitting.");
      }
    } catch (error) {
      setPageError(extractErrorMessage(error, "Receipt upload failed. Please try again."));
    } finally {
      busyRef.current = false;
      setScanning(false);
    }
  }

  function handleTicketChange(ticketID) {
    setSelectedTicketId(ticketID);
    if (ticketID) setField("category", "Materials");
  }

  function updateLineItem(index, name, value) {
    setDraft((current) => ({
      ...current,
      lineItems: current.lineItems.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [name]: value } : item
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

  async function handleSubmit(event) {
    event.preventDefault();
    if (busyRef.current) return;
    setPageError("");
    setPageNotice("");
    if (!selectedTicket || !draft.receiptImageURL || !canSubmit) {
      setPageError("Choose a resolved procurement ticket, upload a receipt, and complete the required fields.");
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
          ...(item.unitPrice !== "" && Number.isFinite(Number(item.unitPrice))
            ? { unitPrice: Number(item.unitPrice) }
            : {}),
        })),
      };
      const expense = await submitExpense(payload);
      setPageNotice(`Expense submitted as Pending${expense.expenseID ? ` (${expense.expenseID})` : ""}.`);
      setDraft({ ...EMPTY_DRAFT, lineItems: [{ ...EMPTY_DRAFT.lineItems[0] }] });
      setSelectedTicketId("");
      setReceiptName("");
      setOcrNotice("");
      setVendorInfo({ autoFilled: [], conflicts: [] });
    } catch (error) {
      // Keep the draft so the user can fix the problem and retry.
      setPageError(extractErrorMessage(error, "Expense submission failed. Please check the details and retry."));
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  }

  const vendorLabel = (label, field) =>
    vendorInfo.autoFilled.includes(field) ? `${label} (from vendor list)` : label;

  if (!user || !["General Manager", "Project Manager"].includes(user.role)) {
    return <Banner tone="error" title="Not authorized">This submission page is for General Managers and Project Managers.</Banner>;
  }

  return (
    <div className="submit-expense-page">
      <LoadingOverlay
        open={scanning || submitting}
        message={scanning ? "Reading receipt…" : "Submitting expense…"}
        detail={scanning ? "Uploading and running OCR. This can take a few seconds." : "Please don't close this page."}
      />
      <div className="submit-expense-header">
        <div>
          <BackLink to="/expenses">Back to expenses</BackLink>
          <h1>Submit Expense</h1>
          <p className="submit-expense-subtitle">
            Upload a receipt, verify its details, and link it to a resolved procurement ticket.
          </p>
        </div>
        <span className="submit-expense-role">{user.role}</span>
      </div>

      {pageError && <Banner tone="error" title="Could not continue">{pageError}</Banner>}
      {pageNotice && <Banner tone="info" title="Submission saved">{pageNotice}</Banner>}
      {ocrNotice && <Banner tone="warning" title="Review the receipt carefully">{ocrNotice}</Banner>}
      {vendorInfo.conflicts.length > 0 && (
        <Banner tone="warning" title="Receipt differs from the vendor list">
          {vendorInfo.conflicts.map((c) => `${VENDOR_FIELD_LABELS[c.field] || c.field}: receipt reads ${c.ocrValue}, vendor list has ${c.masterValue}`).join(" · ")}.
          {" "}The vendor list value was used. Check the paper receipt.
        </Banner>
      )}

      <form className="submit-expense-form" onSubmit={handleSubmit}>
        <Card className="submit-expense-card">
          <section className="submit-expense-section" aria-labelledby="receipt-source-heading">
            <div className="submit-expense-section-heading">
              <div>
                <h2 id="receipt-source-heading">1. Add receipt</h2>
                <p>Use a camera-capable mobile browser, choose an image, or upload a PDF (10 MB maximum).</p>
              </div>
              {receiptName && <span className="submit-expense-filename">{receiptName}</span>}
            </div>

            <input ref={cameraInput} className="submit-expense-hidden-input" type="file" accept="image/jpeg,image/png" capture="environment" onChange={handleReceiptPick} />
            <input ref={imageInput} className="submit-expense-hidden-input" type="file" accept="image/jpeg,image/png" onChange={handleReceiptPick} />
            <input ref={pdfInput} className="submit-expense-hidden-input" type="file" accept="application/pdf,.pdf" onChange={handleReceiptPick} />

            <div className="submit-expense-upload-actions">
              <Button type="button" onClick={() => cameraInput.current?.click()} disabled={scanning}>Capture with camera</Button>
              <Button type="button" variant="secondary" onClick={() => imageInput.current?.click()} disabled={scanning}>Choose image</Button>
              <Button type="button" variant="secondary" onClick={() => pdfInput.current?.click()} disabled={scanning}>Choose PDF</Button>
              {scanning && <span className="submit-expense-progress" role="status">Uploading and scanning…</span>}
            </div>

            {draft.receiptImageURL && (
              <div className="submit-expense-receipt-preview">
                {receiptName.toLowerCase().endsWith(".pdf") ? (
                  <iframe
                    className="submit-expense-pdf-preview"
                    title="Uploaded receipt PDF preview"
                    src={draft.receiptImageURL}
                  />
                ) : (
                  <img
                    className="submit-expense-image-preview"
                    src={draft.receiptImageURL}
                    alt="Uploaded receipt preview"
                  />
                )}
                <a className="submit-expense-receipt-link" href={draft.receiptImageURL} target="_blank" rel="noreferrer">
                  Open the uploaded receipt separately
                </a>
              </div>
            )}
          </section>
        </Card>

        <Card className="submit-expense-card">
          <section className="submit-expense-section" aria-labelledby="ticket-heading">
            <div className="submit-expense-section-heading">
              <div>
                <h2 id="ticket-heading">2. Link procurement ticket</h2>
                <p>Only resolved Material Request tickets are listed. The server checks your project access again at submission.</p>
              </div>
            </div>

            <Field
              as="select"
              label="Resolved procurement ticket"
              required
              value={selectedTicketId}
              onChange={(event) => handleTicketChange(event.target.value)}
              disabled={loadingTickets || tickets.length === 0}
            >
              <option value="">{loadingTickets ? "Loading tickets…" : "Choose a ticket"}</option>
              {tickets.map((ticket) => (
                <option key={ticket.ticketID} value={ticket.ticketID}>
                  {ticket.projectName} — {ticket.subject} ({ticket.vendorName || "vendor not specified"})
                </option>
              ))}
            </Field>
            {selectedTicket && (
              <div className="submit-expense-ticket-context">
                <strong>{selectedTicket.projectName}</strong>
                <span>{selectedTicket.materialType || "Material Request"}</span>
                {selectedTicket.quantity != null && <span>Requested quantity: {selectedTicket.quantity}</span>}
              </div>
            )}
            {!loadingTickets && tickets.length === 0 && !pageError && (
              <Banner tone="info" title="No resolved procurement tickets">A Purchaser must complete a Material Request before it can be linked here.</Banner>
            )}
          </section>
        </Card>

        <Card className="submit-expense-card">
          <section className="submit-expense-section" aria-labelledby="review-heading">
            <div className="submit-expense-section-heading">
              <div>
                <h2 id="review-heading">3. Review and correct extracted fields</h2>
                <p>OCR is a draft only. Confirm every value against the receipt before submitting.</p>
              </div>
            </div>

            <div className="submit-expense-fields">
              <Field label="Vendor / store name" required value={draft.vendorName} onChange={(event) => setField("vendorName", event.target.value)} />
              <Field label="Receipt total (₱)" required type="number" min="0" step="0.01" value={draft.amount} onChange={(event) => setField("amount", event.target.value)} />
              <Field label="Receipt date" required type="date" value={draft.receiptDate} onChange={(event) => setField("receiptDate", event.target.value)} />
              <Field as="select" label="Expense category" required value={draft.category} onChange={(event) => setField("category", event.target.value)}>
                <option value="Materials">Materials</option>
                <option value="Equipment">Equipment</option>
                <option value="Other">Other</option>
              </Field>
              <Field label={vendorLabel("TIN", "tin")} value={draft.tin} onChange={(event) => setField("tin", event.target.value)} />
              <Field label={vendorLabel("BIR authority type", "birPermitType")} value={draft.birPermitType} onChange={(event) => setField("birPermitType", event.target.value)} placeholder="Permit, PTU, or ATP" />
              <Field label={vendorLabel("BIR permit number", "birPermitNumber")} value={draft.birPermitNumber} onChange={(event) => setField("birPermitNumber", event.target.value)} />
              <Field label="OR / SI number" value={draft.birNumber} onChange={(event) => setField("birNumber", event.target.value)} />
            </div>

            <div className="submit-expense-items-heading">
              <div>
                <h3>Receipt line items</h3>
                <p>At least one line item with a description and amount is required.</p>
              </div>
              <Button type="button" variant="secondary" onClick={addLineItem}>Add item</Button>
            </div>
            <div className="submit-expense-items">
              {draft.lineItems.map((item, index) => (
                <div className="submit-expense-item-row" key={`item-${index}`}>
                  <Field label={`Item ${index + 1}`} required value={item.description} onChange={(event) => updateLineItem(index, "description", event.target.value)} placeholder="Description" />
                  <Field label="Item amount (₱)" required type="number" min="0" step="0.01" value={item.amount} onChange={(event) => updateLineItem(index, "amount", event.target.value)} />
                  <Field label="Quantity (0 for delivery, VAT, fees)" required type="number" min="0" step="0.01" value={item.quantity} onChange={(event) => updateLineItem(index, "quantity", event.target.value)} />
                  <Field label="Unit price (₱)" type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => updateLineItem(index, "unitPrice", event.target.value)} />
                  <Button type="button" variant="ghost" className="submit-expense-remove-item" onClick={() => removeLineItem(index)} disabled={draft.lineItems.length <= 1} aria-label={`Remove item ${index + 1}`}>Remove</Button>
                </div>
              ))}
            </div>
          </section>
        </Card>

        <div className="submit-expense-footer">
          <p>Submitting creates a Pending expense for review. Approval and blockchain recording are separate steps.</p>
          <Button type="submit" disabled={!canSubmit}>{submitting ? "Submitting…" : "Submit expense"}</Button>
        </div>
      </form>
    </div>
  );
}
