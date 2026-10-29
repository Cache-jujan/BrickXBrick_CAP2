import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { listOpenRequests, previewAllocation, submitAllocation } from "../../api/allocationsApi";
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
import { RequestPickerModal } from "../../components/expenses/RequestPickerModal";
import { LoadingOverlay } from "../../components/ui/LoadingOverlay";
import { EMPTY_DRAFT, draftFromScan, isSupportedReceipt } from "./SubmitExpensePage";
import { editLine } from "../../utils/lineItemMath";
import { useLocale } from "../../i18n/LocaleProvider";
import "./SubmitExpensePage.css";
import "./SplitReceiptPage.css";

// F8 split receipt (UC-08-01), GM/PM backup actors. One receipt is scanned; the
// SERVER splits each line across the open Material Requests for that material,
// oldest request first, and saves one expense per request. This page only
// collects the receipt, shows the server's preview, and lets the actor exclude
// a request ("Not for this request"), move a fee/VAT line to another portion, or
// match a line to a request by hand ("Match to a request", searchable).
//
// Buying more than every request wants is allowed: the extra rides on the last request and
// the PM is told. Spending past the project's allowance, or buying extra, needs a short reason.

// A line starting with this makes the expense go to PM review (Receipt_Adjustment flag).
const ADJUSTMENT_PREFIX = "Adjustment";
const QUICK_REASONS = [
  { key: "ck.reason_price", text: "Prices went up." },
  { key: "ck.reason_delivery", text: "Delivery or gas." },
  { key: "ck.reason_promo", text: "The store gave extra." },
];

/** Create an empty receipt draft with its own editable line item. */
const blankDraft = () => ({ ...EMPTY_DRAFT, lineItems: [{ ...EMPTY_DRAFT.lineItems[0] }] });
/** Format a numeric amount as Philippine pesos with two decimal places. */
const peso = (value) =>
  `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Return whether a nonempty field converts to a finite, nonnegative number. */
const isNonNegativeNumber = (value) => value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
/** Round a numeric peso amount to integer centavos for total comparisons. */
const toCents = (value) => Math.round(Number(value) * 100);

/** Render the managers' receipt scan, correction, split preview and submission flow. */
export function SplitReceiptPage() {
  const { user } = useAuth();
  const { t, tv } = useLocale();
  const busyRef = useRef(false);

  const [draft, setDraft] = useState(blankDraft);
  const [receiptName, setReceiptName] = useState("");
  // Only the short upload is waited for; reading the receipt happens in the background.
  const [uploading, setUploading] = useState(false);
  // The scan whose result is in the form now (removed from the tray once the split is saved).
  const [activeScanID, setActiveScanID] = useState("");
  // The tax fields are folded away; the user can open them.
  const [taxOpen, setTaxOpen] = useState(false);
  const { startScan, dismissScan } = useReceiptScans();
  const [submitting, setSubmitting] = useState(false);
  const [pageError, setPageError] = useState("");
  const [ocrNotice, setOcrNotice] = useState("");

  // Allocation state. `allocating` turns on after "Preview split"; from then on
  // the preview re-runs whenever the lines, exclusions or fee moves change.
  const [allocating, setAllocating] = useState(false);
  const [excluded, setExcluded] = useState([]);
  const [feeTargets, setFeeTargets] = useState({});
  const [plan, setPlan] = useState(null);
  const [known, setKnown] = useState({});
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [submitProblems, setSubmitProblems] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [result, setResult] = useState(null);
  // The open requests, for the "Match to a request" picker.
  const [openRequests, setOpenRequests] = useState([]);
  const [pickingIndex, setPickingIndex] = useState(null);
  // Why the receipt went over (extra quantity, spending past the allowance). The PM reads it.
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    listOpenRequests()
      .then((rows) => { if (!cancelled) setOpenRequests(rows); })
      // The picker is a shortcut; without it the line is renamed by hand.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [refreshKey]);

  /** Replace one receipt field while preserving the rest of the draft. */
  function setField(name, value) {
    setDraft((current) => ({ ...current, [name]: value }));
  }

  /** Update one line field, synchronizing quantity, unit price and amount for numeric edits. */
  function updateLineItem(index, name, value) {
    setDraft((current) => ({
      ...current,
      lineItems: current.lineItems.map((item, i) => {
        if (i !== index) return item;
        if (name === "description") return { ...item, description: value, matchedTicketID: null };
        return ["quantity", "unitPrice", "amount"].includes(name) ? editLine(item, name, value) : { ...item, [name]: value };
      }),
    }));
  }

  /** Append a blank editable receipt line. */
  function addLineItem() {
    setDraft((current) => ({
      ...current,
      lineItems: [...current.lineItems, { description: "", amount: "", quantity: "", unitPrice: "" }],
    }));
  }

  /** Remove the indexed line while keeping at least one editable row. */
  function removeLineItem(index) {
    setDraft((current) => ({
      ...current,
      lineItems: current.lineItems.length <= 1 ? current.lineItems : current.lineItems.filter((_, i) => i !== index),
    }));
  }

  // Every line needs a quantity (0 for delivery, VAT, fees): the split is by quantity.
  const namedLineItems = draft.lineItems.filter((item) => item.description.trim());
  const validLineItems = namedLineItems.filter(
    (item) => isNonNegativeNumber(item.amount) && isNonNegativeNumber(item.quantity)
  );
  const allLinesValid = namedLineItems.length > 0 && validLineItems.length === namedLineItems.length;
  const amountIsValid = isNonNegativeNumber(draft.amount);

  const linesCents = validLineItems.reduce((sum, item) => sum + toCents(item.amount), 0);
  const totalMatches = amountIsValid && allLinesValid && linesCents === toCents(draft.amount);

  const splitLines = useMemo(
    () =>
      validLineItems.map((item) => ({
        description: item.description.trim(),
        quantity: Number(item.quantity),
        amount: Number(item.amount),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(validLineItems)]
  );

  // Lines matched to a request by hand: { position among the valid lines: ticketID }, as the server expects.
  const lineTargets = useMemo(
    () =>
      Object.fromEntries(
        validLineItems.flatMap((item, index) => (item.matchedTicketID ? [[String(index), item.matchedTicketID]] : []))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(validLineItems)]
  );

  const readyToPreview = Boolean(
    draft.receiptImageURL && draft.vendorName.trim() && draft.receiptDate && amountIsValid && allLinesValid && totalMatches
  );

  // What is still missing before the split can be previewed: tags on the boxes, and the reason
  // shown beside the greyed-out button.
  const gapOfLines = lineGaps(draft.lineItems);
  const missing = { vendor: !draft.vendorName.trim(), amount: !amountIsValid, date: !draft.receiptDate };
  const previewGaps = [
    !draft.receiptImageURL && t("gap.receipt"),
    missing.vendor && t("submit.vendor_name"),
    missing.amount && t("submit.receipt_total"),
    missing.date && t("my_expenses.receipt_date"),
    gapOfLines.none && t("gap.line_item"),
    gapOfLines.numbers && t("gap.line_numbers"),
    allLinesValid && amountIsValid && !totalMatches && t("gap.total_match"),
  ].filter(Boolean);

  /** Clear allocation choices, preview results and errors for a fresh preview. */
  function resetAllocation() {
    setAllocating(false);
    setExcluded([]);
    setFeeTargets({});
    setPlan(null);
    setKnown({});
    setPreviewError("");
    setSubmitProblems([]);
    setNote("");
  }

  // Picking a file only uploads it and puts it in the tray; the receipt you are splitting stays
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
      await startScan(file, "split");
    } catch (error) {
      setPageError(extractErrorMessage(error, t("errors.upload_failed")));
    } finally {
      setUploading(false);
    }
  }

  /** Load a scan from the tray: replaces the draft and clears any old allocation. */
  function openScan(scan) {
    setPageError("");
    setResult(null);
    resetAllocation();
    setReceiptName(scan.context?.fileName || "");
    setActiveScanID(scan.scanID);
    if (scan.status === "Ready" && scan.result) {
      setDraft(draftFromScan({ ...scan.result, receiptImageURL: scan.result.receiptImageURL || scan.receiptImageURL }));
      setOcrNotice(scan.result.ocrError || (scan.result.confidence === "low" ? t("split.ocr_low") : ""));
    } else {
      // Could not be read: the photo is stored, so the details are typed in by hand.
      setDraft({ ...blankDraft(), receiptImageURL: scan.receiptImageURL });
      setOcrNotice(t("scan.manual_notice"));
    }
  }

  // Arriving from the "receipt ready" pop-up or the bell (?scan=<id>).
  useOpenWantedScan("split", openScan);

  // Live preview. Debounced so typing in a quantity doesn't fire a request per key.
  useEffect(() => {
    if (!allocating || result) return undefined;
    if (!allLinesValid) {
      setPlan(null);
      return undefined;
    }
    let cancelled = false;
    setPreviewing(true);
    setPreviewError("");
    const timer = setTimeout(() => {
      previewAllocation(splitLines, { excludeTicketIDs: excluded, feeTargets, lineTargets })
        .then((next) => {
          if (cancelled) return;
          setPlan(next);
          // Remember every request we have seen so an excluded one stays listed
          // and can be switched back on.
          setKnown((prev) => {
            const merged = { ...prev };
            for (const p of next.portions) {
              merged[p.ticketID] = { ticketID: p.ticketID, projectName: p.projectName, materialType: p.materialType };
            }
            return merged;
          });
        })
        .catch((error) => {
          if (cancelled) return;
          setPlan(null);
          setPreviewError(extractErrorMessage(error, t("split.preview_failed")));
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [allocating, result, allLinesValid, splitLines, excluded, feeTargets, lineTargets, refreshKey, t]);

  /** Clear submission problems and refresh the preview to include newly opened requests. */
  function retryPreview() {
    setSubmitProblems([]);
    setRefreshKey((k) => k + 1);
  }

  /** Exclude or restore a request and clear problems from the previous submission. */
  function toggleExcluded(ticketID, value) {
    setSubmitProblems([]);
    setExcluded((prev) => (value ? [...prev, ticketID] : prev.filter((id) => id !== ticketID)));
  }

  /** Assign a fee line to the selected request for the next preview and submission. */
  function moveFee(lineIndex, ticketID) {
    setFeeTargets((prev) => ({ ...prev, [String(lineIndex)]: ticketID }));
  }

  /** Match one receipt line to a request. A fee line (quantity 0) keeps its name; any other line takes the request's material name. */
  function matchLine(index, request) {
    setSubmitProblems([]);
    setDraft((current) => ({
      ...current,
      lineItems: current.lineItems.map((item, i) => {
        if (i !== index) return item;
        const isFee = Number(item.quantity) === 0 && item.quantity !== "";
        return isFee
          ? { ...item, matchedTicketID: request.ticketID }
          : { ...item, description: request.materialType, matchedTicketID: request.ticketID };
      }),
    }));
    setPickingIndex(null);
  }

  /** Forget a hand match so the line is matched by its words again. */
  function clearMatch(index) {
    setSubmitProblems([]);
    setDraft((current) => ({
      ...current,
      lineItems: current.lineItems.map((item, i) => (i === index ? { ...item, matchedTicketID: null } : item)),
    }));
  }

  /**
   * The lines and the receipt total differ: add an "Adjustment" line for the gap, or take an
   * overage off the biggest line as a discount and note it. Either one sends the expense to PM review.
   */
  function applyAdjustment() {
    const gap = toCents(draft.amount) - linesCents;
    if (gap === 0) return;
    setDraft((current) => {
      if (gap > 0) {
        return {
          ...current,
          lineItems: [...current.lineItems, { description: `${ADJUSTMENT_PREFIX} / rounding`, quantity: "0", amount: (gap / 100).toFixed(2), unitPrice: "" }],
        };
      }
      const over = -gap;
      let biggest = -1;
      current.lineItems.forEach((item, i) => {
        if (Number(item.quantity) > 0 && (biggest < 0 || toCents(item.amount) > toCents(current.lineItems[biggest].amount))) biggest = i;
      });
      if (biggest < 0) return current;
      const lineItems = current.lineItems.map((item, i) =>
        i === biggest ? editLine(item, "amount", ((toCents(item.amount) - over) / 100).toFixed(2)) : item
      );
      lineItems.push({
        description: `${ADJUSTMENT_PREFIX}: ${peso(over / 100)} discount taken off ${current.lineItems[biggest].description}`,
        quantity: "0",
        amount: "0.00",
        unitPrice: "",
      });
      return { ...current, lineItems };
    });
  }

  // Extra quantity or spending past the allowance needs a few words for the PM.
  const extraPortions = (plan?.portions ?? []).filter((p) => Number(p.extraQuantity) > 0);
  const overAllowancePortions = (plan?.portions ?? []).filter((p) => p.overAllowance);
  const needsReason = extraPortions.length > 0 || overAllowancePortions.length > 0;
  const reasonOk = !needsReason || note.trim().length > 0;

  const canSubmit = Boolean(
    plan?.ok && draft.category && readyToPreview && reasonOk && !previewing && !uploading && !submitting && !result
  );

  /** Submit a valid split once, displaying saved results or refreshing stale request capacity. */
  async function handleSubmit() {
    if (!canSubmit || busyRef.current) return;
    busyRef.current = true;
    setSubmitting(true);
    setPageError("");
    setSubmitProblems([]);
    try {
      const saved = await submitAllocation({
        receiptImageURL: draft.receiptImageURL,
        vendorName: draft.vendorName.trim(),
        receiptDate: draft.receiptDate,
        category: draft.category,
        tin: draft.tin.trim() || null,
        birPermitNumber: draft.birPermitNumber.trim() || null,
        birNumber: draft.birNumber.trim() || null,
        receiptTotal: Number(draft.amount),
        lineItems: splitLines,
        excludeTicketIDs: excluded,
        feeTargets,
        lineTargets,
        note: needsReason ? note.trim() : undefined,
      });
      setResult(saved);
      if (activeScanID) { dismissScan(activeScanID); setActiveScanID(""); } // this receipt is done: take it off the tray
    } catch (error) {
      const problems = error?.response?.data?.details?.problems;
      if (Array.isArray(problems)) {
        // The requests changed since the preview (another receipt filled one).
        setSubmitProblems(problems);
        setRefreshKey((k) => k + 1);
      } else {
        setPageError(extractErrorMessage(error, t("errors.split_failed")));
      }
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  }

  /** Clear the completed result, receipt draft, allocation state and notices for another receipt. */
  function startOver() {
    setResult(null);
    resetAllocation();
    setDraft(blankDraft());
    setReceiptName("");
    setOcrNotice("");
    setPageError("");
  }

  if (!user || !["General Manager", "Project Manager"].includes(user.role)) {
    return <Banner tone="error" title={t("auth.not_authorized_title")}>{t("split.not_authorized_body")}</Banner>;
  }

  // ---- After a successful submit ------------------------------------------
  if (result) {
    /** Resolve a saved request's project name, using a fallback if it is unknown. */
    const name = (id) => known[id]?.projectName ?? t("split.request");
    const screening = Object.values(result.screening ?? {});
    const flagged = screening.filter((s) => (s.flagTypes ?? []).length > 0).length;
    const notScreened = screening.filter((s) => s.flagTypes === null).length;
    return (
      <div className="submit-expense-page" data-mode="split">
        <ExpenseModeBar mode="split" />
        <Banner tone="info" title={t("split.saved_title")}>{t("split.saved_subtitle", { count: result.expenses.length })}</Banner>
        <Card className="submit-expense-card">
          <section className="submit-expense-section">
            <h2>{t("split.completed_requests")}</h2>
            {result.resolvedTicketIDs.length === 0 ? <p>{t("split.none")}</p> : (
              <ul className="split-result-list">
                {result.resolvedTicketIDs.map((id) => <li key={id}>✓ {name(id)}</li>)}
              </ul>
            )}
            <h2>{t("split.still_open")}</h2>
            {result.stillOpenTicketIDs.length === 0 ? <p>{t("split.none")}</p> : (
              <ul className="split-result-list">
                {result.stillOpenTicketIDs.map((id) => <li key={id}>• {name(id)}</li>)}
              </ul>
            )}
            {flagged > 0 && <Banner tone="warning" title={t("split.flagged_title")}>{t("split.flagged_body", { count: flagged })}</Banner>}
            {notScreened > 0 && <Banner tone="error" title={t("split.not_screened_title")}>{t("split.not_screened_body", { count: notScreened })}</Banner>}
          </section>
        </Card>
        <div className="submit-expense-footer">
          <Link to="/expenses" className="btn btn-primary">{t("submit.back")}</Link>
          <Button type="button" variant="secondary" onClick={startOver}>{t("split.another")}</Button>
        </div>
      </div>
    );
  }

  const needsRetry = Boolean(plan && (plan.unmatched.length > 0 || plan.portions.length === 0));
  const portionByTicket = new Map((plan?.portions ?? []).map((p) => [p.ticketID, p]));
  const requestIDs = [
    ...(plan?.portions ?? []).map((p) => p.ticketID),
    ...excluded.filter((id) => !portionByTicket.has(id)),
  ];
  const feeLines = (plan?.portions ?? []).flatMap((p) =>
    p.lines.filter((line) => Number(line.quantity) === 0).map((line) => ({ ...line, ticketID: p.ticketID }))
  );
  /** Find the current plan's budget warning for a request, if any. */
  const warningFor = (ticketID) => plan?.warnings?.find((w) => w.type === "OVER_BUDGET" && w.ticketID === ticketID);

  return (
    <div className="submit-expense-page" data-mode="split">
      <LoadingOverlay
        open={submitting}
        message={t("split.submitting")}
        detail={t("split.creating")}
      />
      <ExpenseModeBar mode="split" />

      {pageError && <Banner tone="error" title={t("submit.could_not_continue")}>{pageError}</Banner>}
      {ocrNotice && <Banner tone="warning" title={t("submit.review_carefully")}>{ocrNotice}</Banner>}

      <div className="xp-layout">
      <Card className="submit-expense-card xp-receipt">
        <section className="submit-expense-section" aria-labelledby="split-receipt-heading">
          <div className="submit-expense-section-heading">
            <div>
              <h2 id="split-receipt-heading">{t("submit.step1_title")}</h2>
              <p>{t("split.step1_help")}</p>
            </div>
            {receiptName && <span className="submit-expense-filename">{receiptName}</span>}
          </div>

          <ReceiptCapture onFile={handleReceiptPick} disabled={uploading} uploading={uploading} />

          <ReceiptScanTray mode="split" activeScanID={activeScanID} onOpen={openScan} />

          {draft.receiptImageURL && (
            <div className="submit-expense-receipt-preview">
              {receiptName.toLowerCase().endsWith(".pdf") ? (
                <iframe className="submit-expense-pdf-preview" title={t("submit.pdf_preview_title")} src={draft.receiptImageURL} />
              ) : (
                <img className="submit-expense-image-preview" src={draft.receiptImageURL} alt={t("submit.image_preview_alt")} />
              )}
              <a className="submit-expense-receipt-link" href={draft.receiptImageURL} target="_blank" rel="noreferrer">
                {t("submit.open_receipt")}
              </a>
            </div>
          )}
        </section>
      </Card>

      <Card className="submit-expense-card xp-details">
        <section className="submit-expense-section" aria-labelledby="split-review-heading">
          <div className="submit-expense-section-heading">
            <div>
              <h2 id="split-review-heading">{t("split.step2_title")}</h2>
              <p>{t("split.step2_help")}</p>
            </div>
          </div>

          <div className={`submit-expense-fields xp-main-fields`}>
            <Field label={t("submit.vendor_name")} required missing={missing.vendor} value={draft.vendorName} onChange={(e) => setField("vendorName", e.target.value)} />
            <Field label={t("submit.receipt_total")} required missing={missing.amount} type="number" min="0" step="0.01" value={draft.amount} onChange={(e) => setField("amount", e.target.value)} />
            <Field label={t("my_expenses.receipt_date")} required missing={missing.date} type="date" value={draft.receiptDate} onChange={(e) => setField("receiptDate", e.target.value)} />
            <Field as="select" label={t("submit.expense_category")} required value={draft.category} onChange={(e) => setField("category", e.target.value)}>
              <option value="Materials">{tv("category", "Materials")}</option>
              <option value="Equipment">{tv("category", "Equipment")}</option>
              <option value="Other">{tv("category", "Other")}</option>
            </Field>
          </div>

          <TaxDetails open={taxOpen} onToggle={setTaxOpen} filled={Boolean(draft.tin || draft.birPermitNumber || draft.birNumber || draft.birPermitType)}>
            <Field label="TIN" value={draft.tin} onChange={(e) => setField("tin", e.target.value)} />
            <Field label={t("submit.field_bir_permit")} value={draft.birPermitNumber} onChange={(e) => setField("birPermitNumber", e.target.value)} />
            <Field label="OR / SI number" value={draft.birNumber} onChange={(e) => setField("birNumber", e.target.value)} />
          </TaxDetails>

          <div className="submit-expense-items-heading">
            <div>
              <h3>{t("submit.line_items_title")}</h3>
              <p>{t("split.line_help")}</p>
            </div>
            <Button type="button" variant="secondary" onClick={addLineItem}>{t("common.add_item")}</Button>
          </div>
          <div className="submit-expense-items">
            {draft.lineItems.map((item, index) => (
              <div className="split-line-block" key={`item-${index}`}>
              <div className="submit-expense-item-row">
                <Field label={t("submit.item_n", { n: index + 1 })} required missing={gapOfLines.rows[index]?.desc} value={item.description} onChange={(e) => updateLineItem(index, "description", e.target.value)} placeholder={t("submit.description")} />
                <Field label={t("submit.item_amount")} required missing={gapOfLines.rows[index]?.amount} type="number" min="0" step="0.01" value={item.amount} onChange={(e) => updateLineItem(index, "amount", e.target.value)} />
                <Field label={t("split.quantity_fees")} required missing={gapOfLines.rows[index]?.qty} type="number" min="0" step="0.01" value={item.quantity} onChange={(e) => updateLineItem(index, "quantity", e.target.value)} />
                <Field label={t("submit.unit_price")} type="number" min="0" step="0.01" placeholder={t("submit.calculated")} value={item.unitPrice} onChange={(e) => updateLineItem(index, "unitPrice", e.target.value)} />
                <Button type="button" variant="ghost" className="submit-expense-remove-item" onClick={() => removeLineItem(index)} disabled={draft.lineItems.length <= 1} aria-label={t("submit.remove_item_n", { n: index + 1 })}>{t("common.remove")}</Button>
              </div>
              {item.description.trim() && openRequests.length > 0 && (
                <div className="split-match-row">
                  {item.matchedTicketID ? (
                    <>
                      <span className="split-match-chip">
                        {t("rv.matched_chip", {
                          request: openRequests.find((r) => r.ticketID === item.matchedTicketID)?.materialType ?? item.description,
                          project: openRequests.find((r) => r.ticketID === item.matchedTicketID)?.projectName ?? "",
                        })}
                      </span>
                      <Button type="button" variant="ghost" onClick={() => clearMatch(index)}>{t("rv.remove_match")}</Button>
                    </>
                  ) : null}
                  <Button
                    type="button"
                    variant={item.matchedTicketID ? "secondary" : "primary"}
                    className={item.matchedTicketID ? undefined : "split-match-cta"}
                    onClick={() => setPickingIndex(index)}
                  >
                    {!item.matchedTicketID && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
                        <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
                      </svg>
                    )}
                    {t("rv.match_material")}
                  </Button>
                </div>
              )}
              </div>
            ))}
          </div>

          {allLinesValid && amountIsValid && !totalMatches && (
            <Banner
              tone="warning"
              title={t("split.mismatch_title")}
              action={
                <Button type="button" variant="secondary" onClick={applyAdjustment}>
                  {toCents(draft.amount) > linesCents
                    ? t("rv.fix_add", { gap: peso((toCents(draft.amount) - linesCents) / 100) })
                    : t("rv.fix_discount_web", { gap: peso((linesCents - toCents(draft.amount)) / 100) })}
                </Button>
              }
            >
              {t("split.mismatch_body", { lines: peso(linesCents / 100), total: peso(draft.amount) })} {t("split.adjust_hint")}
            </Banner>
          )}

          {!allocating && (
            <div className="submit-expense-footer xp-footer">
              <SubmitBlockers gaps={previewGaps} note={t("split.next_hint")} />
              <Button type="button" disabled={!readyToPreview} onClick={() => setAllocating(true)}>{t("split.preview")}</Button>
            </div>
          )}
        </section>
      </Card>
      </div>

      <RequestPickerModal
        line={pickingIndex !== null ? draft.lineItems[pickingIndex] ?? null : null}
        requests={openRequests}
        onPick={(request) => matchLine(pickingIndex, request)}
        onClose={() => setPickingIndex(null)}
      />

      {allocating && (
        <Card className="submit-expense-card">
          <section className="submit-expense-section" aria-labelledby="split-allocate-heading">
            <div className="submit-expense-section-heading">
              <div>
                <h2 id="split-allocate-heading">{t("split.step3_title")}</h2>
                <p>{t("split.step3_help")}</p>
              </div>
              {previewing && <span className="submit-expense-progress" role="status">{t("split.updating")}</span>}
            </div>

            {previewError && (
              <Banner
                tone="error"
                title={t("split.preview_failed")}
                action={<Button type="button" variant="secondary" onClick={retryPreview} disabled={previewing}>{t("common.retry")}</Button>}
              >
                {previewError}
              </Banner>
            )}
            {submitProblems.length > 0 && (
              <Banner tone="warning" title={t("split.requests_changed")}>
                {submitProblems.join(" ")} {t("split.preview_refreshed")}
              </Banner>
            )}
            {plan && !plan.ok && plan.problems.length > 0 && (
              <Banner
                tone="error"
                title={t("split.cannot_submit")}
                action={needsRetry ? (
                  <Button type="button" variant="secondary" onClick={retryPreview} disabled={previewing}>
                    {previewing ? t("common.checking") : t("common.retry")}
                  </Button>
                ) : undefined}
              >
                <ul className="split-problems">{plan.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
                {needsRetry && <p className="split-muted">{t("split.retry_hint")}</p>}
              </Banner>
            )}
            {extraPortions.length > 0 && (
              <Banner tone="warning" title={t("split.extra_title")}>
                <ul className="split-problems">
                  {extraPortions.map((p) => (
                    <li key={p.ticketID}>{t("ck.extra", { qty: p.extraQuantity, material: p.materialType, project: p.projectName })}</li>
                  ))}
                </ul>
              </Banner>
            )}
            {plan?.warnings?.some((w) => w.type === "OVER_BUDGET") && (
              <Banner tone="warning" title={t("dashboard.over_budget")}>
                {overAllowancePortions.length > 0 ? t("split.over_allowance_body") : t("split.over_budget_body")}
              </Banner>
            )}
            {needsReason && (
              <div className="split-note">
                <Field
                  as="textarea"
                  label={t("ck.reason_title")}
                  required
                  maxLength={200}
                  placeholder={t("ck.reason_hint")}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="split-note-quick">
                  {QUICK_REASONS.map((reason) => (
                    <Button key={reason.key} type="button" variant="secondary" onClick={() => setNote((current) => (current ? `${current} ${reason.text}` : reason.text))}>
                      {t(reason.key)}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="split-portions">
              {requestIDs.map((ticketID) => {
                const portion = portionByTicket.get(ticketID);
                const isExcluded = excluded.includes(ticketID);
                const info = known[ticketID];
                const warning = warningFor(ticketID);
                return (
                  <div key={ticketID} className={`split-portion${isExcluded ? " split-portion-excluded" : ""}`}>
                    <div className="split-portion-head">
                      <div>
                        <strong>{portion?.projectName ?? info?.projectName ?? t("split.request")}</strong>
                        <span className="split-muted"> · {portion?.materialType ?? info?.materialType}</span>
                      </div>
                      <label className="split-exclude">
                        <input type="checkbox" checked={isExcluded} onChange={(e) => toggleExcluded(ticketID, e.target.checked)} />
                        {t("split.not_for_request")}
                      </label>
                    </div>
                    {portion && !isExcluded && (
                      <>
                        <div className="split-portion-summary">
                          <span>{t("split.units", { quantity: portion.quantity })}</span>
                          <span>{peso(portion.amount)}</span>
                          <span className={portion.resolvesTicket ? "split-done" : "split-open"}>
                            {portion.resolvesTicket ? t("split.completes") : t("split.stays_open", { remaining: portion.remainingAfter })}
                          </span>
                          {warning && <span className="split-over">{t("split.over_budget_left", { amount: warning.remainingBudget })}</span>}
                          {Number(portion.extraQuantity) > 0 && <span className="split-over">{t("split.extra_badge", { qty: portion.extraQuantity })}</span>}
                        </div>
                        <table className="split-lines">
                          <thead><tr><th>{t("split.col_line")}</th><th>{t("split.col_qty")}</th><th>{t("dashboard.amount")}</th></tr></thead>
                          <tbody>
                            {portion.lines.map((line) => (
                              <tr key={`${line.lineIndex}-${line.quantity}`}>
                                <td>{line.description}</td>
                                <td>{line.quantity}</td>
                                <td>{peso(line.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                );
              })}
              {plan && requestIDs.length === 0 && (
                <Banner
                  tone="info"
                  title={t("split.no_open_title")}
                  action={<Button type="button" variant="secondary" onClick={retryPreview} disabled={previewing}>{previewing ? t("common.checking") : t("common.retry")}</Button>}
                >
                  {t("split.no_open_body")}
                </Banner>
              )}
            </div>

            {plan && plan.unmatched.length > 0 && (
              <div className="split-uncovered">
                <h3>{t("split.uncovered_title")}</h3>
                <ul>
                  {plan.unmatched.map((line, i) => (
                    <li key={i}>{t("split.uncovered_line", { description: line.description, quantity: line.quantity, amount: peso(line.amount) })}</li>
                  ))}
                </ul>
              </div>
            )}

            {feeLines.length > 0 && (plan?.portions.length ?? 0) > 1 && (
              <div className="split-fees">
                <h3>{t("split.fees_title")}</h3>
                <p className="split-muted">{t("split.fees_help")}</p>
                {feeLines.map((line) => (
                  <SearchableSelect
                    key={line.lineIndex}
                    label={`${line.description} (${peso(line.amount)})`}
                    value={line.ticketID}
                    onChange={(v) => moveFee(line.lineIndex, v)}
                    options={plan.portions.map((p) => ({ value: p.ticketID, label: `${p.projectName} · ${p.materialType}` }))}
                    searchPlaceholder={t("ss.search_ph")}
                    noMatchText={t("ss.no_match", { query: "{query}" })}
                  />
                ))}
              </div>
            )}

            {plan && (
              <p className="split-totals">
                {t("split.totals", { allocated: peso(plan.allocated), total: peso(plan.linesTotal) })}
              </p>
            )}

            <div className="submit-expense-footer">
              <SubmitBlockers gaps={[needsReason && !reasonOk && t("gap.split_reason")].filter(Boolean)} note={t("split.footer_note")} />
              <Button type="button" disabled={!canSubmit} onClick={handleSubmit}>
                {submitting ? t("common.submitting") : t("split.submit_for_approval")}
              </Button>
            </div>
          </section>
        </Card>
      )}
    </div>
  );
}
