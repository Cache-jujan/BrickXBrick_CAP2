import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { submitTripCost } from "../../api/allocationsApi";
import { listProjects } from "../../api/projectsApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useReceiptScans, useOpenWantedScan } from "../../context/ReceiptScanContext";
import { ReceiptScanTray } from "../../components/expenses/ReceiptScanTray";
import { ExpenseModeBar } from "../../components/expenses/ExpenseModeBar";
import { ReceiptCapture } from "../../components/expenses/ReceiptCapture";
import { TaxDetails } from "../../components/expenses/TaxDetails";
import { SubmitBlockers } from "../../components/expenses/SubmitBlockers";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { LoadingOverlay } from "../../components/ui/LoadingOverlay";
import { EMPTY_DRAFT, draftFromScan, isSupportedReceipt } from "./SubmitExpensePage";
import { useLocale } from "../../i18n/LocaleProvider";
import "./SubmitExpensePage.css";
import "./TripCostPage.css";

// Petty cash (the page and route keep their first name, "trip cost"): small cash costs with
// no request to match, such as snacks, gas for delivery or allowance. A General Manager or
// Project Manager scans the receipt, picks what it was for, writes a note saying what the
// expense was for, and ticks the projects it served; the server splits the total evenly and
// each project's Project Manager approves their share. A Project Manager can charge the
// Active projects they manage; a General Manager any Active project.

// The buttons offered. The value is what the server stores.
const REASONS = [
  { value: "Snacks", labelKey: "tc.reason_snacks" },
  { value: "Gas", labelKey: "tc.reason_gas" },
  { value: "Allowance", labelKey: "tc.reason_allowance" },
  { value: "Other", labelKey: "tc.reason_other" },
];

const peso = (value) =>
  `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const newReceiptId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : null);

/** Render the scan, reason buttons, note, project checklist and submit flow for a petty cash receipt. */
export function TripCostPage() {
  const { user } = useAuth();
  const { t } = useLocale();
  const busyRef = useRef(false);
  // One id per receipt, kept across retries, so a lost response cannot save it twice.
  const receiptIdRef = useRef(newReceiptId());

  const [draft, setDraft] = useState({ ...EMPTY_DRAFT, lineItems: [] });
  const [receiptName, setReceiptName] = useState("");
  // Only the short upload is waited for; reading the receipt happens in the background.
  const [uploading, setUploading] = useState(false);
  // The scan whose result is in the form now (removed from the tray once the petty cash is sent).
  const [activeScanID, setActiveScanID] = useState("");
  const { startScan, dismissScan } = useReceiptScans();
  // The tax fields are folded away; the user can open them.
  const [taxOpen, setTaxOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pageError, setPageError] = useState("");
  const [ocrNotice, setOcrNotice] = useState("");
  // No default: the person picks what the money was for.
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [projects, setProjects] = useState([]);
  const [picked, setPicked] = useState([]);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // The server scopes this list to the caller: a PM sees the projects they manage, a GM all of them.
    listProjects("Active")
      .then((rows) => { if (!cancelled) setProjects(rows); })
      .catch((error) => { if (!cancelled) setPageError(extractErrorMessage(error, t("tc.projects_failed"))); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Replace one receipt field while preserving the rest of the draft. */
  function setField(name, value) {
    setDraft((current) => ({ ...current, [name]: value }));
  }

  // Picking a file only uploads it and puts it in the tray; what you are filling in stays as it is.
  async function handleReceiptPick(file) {
    if (!file || uploading) return;
    setPageError("");
    if (!isSupportedReceipt(file)) {
      setPageError(t("errors.receipt_type"));
      return;
    }
    setUploading(true);
    try {
      await startScan(file, "petty");
    } catch (error) {
      setPageError(extractErrorMessage(error, t("errors.upload_failed")));
    } finally {
      setUploading(false);
    }
  }

  /** Load a scan from the tray into the form (its draft, or just the photo when it could not be read). */
  function openScan(scan) {
    setPageError("");
    setResult(null);
    setReceiptName(scan.context?.fileName || "");
    setActiveScanID(scan.scanID);
    if (scan.status === "Ready" && scan.result) {
      setDraft({ ...draftFromScan({ ...scan.result, receiptImageURL: scan.result.receiptImageURL || scan.receiptImageURL }), category: "Other" });
      setOcrNotice(scan.result.ocrError || (scan.result.confidence === "low" ? t("split.ocr_low") : ""));
    } else {
      setDraft({ ...EMPTY_DRAFT, lineItems: [], category: "Other", receiptImageURL: scan.receiptImageURL });
      setOcrNotice(t("scan.manual_notice"));
    }
  }

  // Arriving from the "receipt ready" pop-up or the bell (?scan=<id>).
  useOpenWantedScan("petty", openScan);

  function toggleProject(id) {
    setPicked((current) => (current.includes(id) ? current.filter((p) => p !== id) : [...current, id]));
  }

  const total = Number(draft.amount);
  const totalOk = draft.amount !== "" && Number.isFinite(total) && total > 0;
  const each = useMemo(() => (picked.length > 0 && totalOk ? total / picked.length : 0), [picked, total, totalOk]);
  // What the money was for (a button) and the note about it are both required.
  const noteOk = note.trim() !== "";
  const canSubmit = Boolean(
    draft.receiptImageURL && draft.vendorName.trim() && draft.receiptDate && totalOk && reason && noteOk && picked.length > 0 && !uploading && !submitting && !result
  );
  // What is still missing: tags on those boxes, and the reason shown beside the greyed-out button.
  const missing = { vendor: !draft.vendorName.trim(), amount: !totalOk, date: !draft.receiptDate, reason: !reason, note: !noteOk };
  const gaps = [
    !draft.receiptImageURL && t("gap.receipt"),
    missing.vendor && t("submit.vendor_name"),
    missing.amount && t("submit.receipt_total"),
    missing.date && t("my_expenses.receipt_date"),
    missing.reason && t("tc.reason_title"),
    missing.note && t("tc.note_label"),
    picked.length === 0 && t("gap.project"),
  ].filter(Boolean);

  /** Send the petty cash once; a retry reuses the same receipt id. */
  async function handleSubmit() {
    if (!canSubmit || busyRef.current) return;
    busyRef.current = true;
    setSubmitting(true);
    setPageError("");
    try {
      const saved = await submitTripCost({
        receiptImageURL: draft.receiptImageURL,
        vendorName: draft.vendorName.trim(),
        receiptDate: draft.receiptDate,
        receiptTotal: total,
        reason,
        projectIds: picked,
        tin: draft.tin.trim() || null,
        birPermitNumber: draft.birPermitNumber.trim() || null,
        birNumber: draft.birNumber.trim() || null,
        note: note.trim(),
        commonReceiptID: receiptIdRef.current ?? undefined,
      });
      setResult(saved);
      if (activeScanID) { dismissScan(activeScanID); setActiveScanID(""); } // this receipt is done: take it off the tray
    } catch (error) {
      // 404: an older backend without the trip-cost route.
      const text = error?.response?.status === 404 ? t("tc.server_old") : extractErrorMessage(error, t("tc.failed"));
      setPageError(text);
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  }

  /** Clear the finished result and the receipt for more petty cash. */
  function startOver() {
    setResult(null);
    setReason("");
    setDraft({ ...EMPTY_DRAFT, lineItems: [] });
    setReceiptName("");
    setOcrNotice("");
    setPageError("");
    setPicked([]);
    setNote("");
    receiptIdRef.current = newReceiptId();
  }

  if (!user || !["General Manager", "Project Manager"].includes(user.role)) {
    return <Banner tone="error" title={t("auth.not_authorized_title")}>{t("split.not_authorized_body")}</Banner>;
  }

  if (result) {
    return (
      <div className="submit-expense-page" data-mode="petty">
        <ExpenseModeBar mode="petty" />
        <Banner tone="info" title={t("tc.saved_title")}>{t("tc.saved_subtitle", { count: result.expenses.length })}</Banner>
        <Card className="submit-expense-card">
          <section className="submit-expense-section">
            <ul className="trip-cost-result">
              {result.expenses.map((expense) => (
                <li key={expense.expenseID}>
                  {projects.find((p) => p.projectid === expense.projectID)?.name ?? t("split.request")} — {peso(expense.amount)}
                </li>
              ))}
            </ul>
            {user.role === "Project Manager" && <Banner tone="info">{t("tc.pm_needs_gm")}</Banner>}
          </section>
        </Card>
        <div className="submit-expense-footer">
          <Link to="/expenses" className="btn btn-primary">{t("submit.back")}</Link>
          <Button type="button" variant="secondary" onClick={startOver}>{t("tc.another")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="submit-expense-page" data-mode="petty">
      <LoadingOverlay open={submitting} message={t("split.submitting")} detail={t("split.creating")} />
      <ExpenseModeBar mode="petty" />

      {pageError && <Banner tone="error" title={t("submit.could_not_continue")}>{pageError}</Banner>}
      {ocrNotice && <Banner tone="warning" title={t("submit.review_carefully")}>{ocrNotice}</Banner>}

      <div className="xp-layout">
      <Card className="submit-expense-card xp-receipt">
        <section className="submit-expense-section" aria-labelledby="trip-receipt-heading">
          <div className="submit-expense-section-heading">
            <div>
              <h2 id="trip-receipt-heading">{t("submit.step1_title")}</h2>
              <p>{t("tc.step1_help")}</p>
            </div>
            {receiptName && <span className="submit-expense-filename">{receiptName}</span>}
          </div>

          <ReceiptCapture onFile={handleReceiptPick} disabled={uploading} uploading={uploading} />

          <ReceiptScanTray mode="petty" activeScanID={activeScanID} onOpen={openScan} />

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
        <section className="submit-expense-section" aria-labelledby="trip-details-heading">
          <div className="submit-expense-section-heading">
            <div>
              <h2 id="trip-details-heading">{t("tc.step2_title")}</h2>
              <p>{t("tc.step2_help")}</p>
            </div>
          </div>

          <div className={`submit-expense-fields xp-main-fields xp-main-fields-3`}>
            <Field label={t("submit.vendor_name")} required missing={missing.vendor} value={draft.vendorName} onChange={(e) => setField("vendorName", e.target.value)} />
            <Field label={t("submit.receipt_total")} required missing={missing.amount} type="number" min="0" step="0.01" value={draft.amount} onChange={(e) => setField("amount", e.target.value)} />
            <Field label={t("my_expenses.receipt_date")} required missing={missing.date} type="date" value={draft.receiptDate} onChange={(e) => setField("receiptDate", e.target.value)} />
          </div>

          <TaxDetails open={taxOpen} onToggle={setTaxOpen} filled={Boolean(draft.tin || draft.birPermitNumber || draft.birNumber || draft.birPermitType)}>
            <Field label="TIN" value={draft.tin} onChange={(e) => setField("tin", e.target.value)} />
            <Field label={t("submit.field_bir_permit")} value={draft.birPermitNumber} onChange={(e) => setField("birPermitNumber", e.target.value)} />
            <Field label="OR / SI number" value={draft.birNumber} onChange={(e) => setField("birNumber", e.target.value)} />
          </TaxDetails>

          <div className="petty-cash-reason">
            <span className="field-label" id="petty-cash-reason-label">
              {t("tc.reason_title")}<span className="field-required"> *</span>
              {missing.reason && <span className="field-missing-tag">{t("gap.needed")}</span>}
            </span>
            <div className="petty-cash-chips" role="radiogroup" aria-labelledby="petty-cash-reason-label">
              {REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={reason === r.value}
                  className={`petty-cash-chip${reason === r.value ? " petty-cash-chip-on" : ""}`}
                  onClick={() => setReason(r.value)}
                >
                  {t(r.labelKey)}
                </button>
              ))}
            </div>
          </div>
          <Field
            as="textarea"
            label={t("tc.note_label")}
            required
            missing={missing.note}
            maxLength={300}
            placeholder={t("tc.note_ph")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </section>

        <section className="submit-expense-section xp-section-next" aria-labelledby="trip-projects-heading">
          <div className="submit-expense-section-heading">
            <div>
              <h2 id="trip-projects-heading">{t("tc.projects_title")}</h2>
              <p>{user.role === "Project Manager" ? t("tc.projects_help_pm") : t("tc.projects_help_gm")}</p>
            </div>
          </div>

          {projects.length === 0 && <p className="trip-cost-muted">{t("tc.no_projects")}</p>}
          <ul className="trip-cost-projects">
            {projects.map((project) => (
              <li key={project.projectid}>
                <label className={`trip-cost-project${picked.includes(project.projectid) ? " trip-cost-project-on" : ""}`}>
                  <input type="checkbox" checked={picked.includes(project.projectid)} onChange={() => toggleProject(project.projectid)} />
                  <span>{project.name}</span>
                </label>
              </li>
            ))}
          </ul>

          {picked.length > 0 && totalOk && (
            <p className="trip-cost-share">{t("tc.share", { count: picked.length, each: peso(each) })}</p>
          )}

          <div className="submit-expense-footer xp-footer">
            <SubmitBlockers gaps={gaps} note={t("tc.footer_note")} />
            <Button type="button" disabled={!canSubmit} onClick={handleSubmit}>
              {submitting ? t("common.submitting") : totalOk ? t("tc.submit", { amount: peso(total) }) : t("tc.title")}
            </Button>
          </div>
        </section>
      </Card>
      </div>
    </div>
  );
}
