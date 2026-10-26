import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { scanReceipt } from "../../api/expensesApi";
import { submitTripCost } from "../../api/allocationsApi";
import { listProjects } from "../../api/projectsApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Banner } from "../../components/ui/Banner";
import { BackLink } from "../../components/ui/BackLink";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { LoadingOverlay } from "../../components/ui/LoadingOverlay";
import { EMPTY_DRAFT, draftFromScan, isSupportedReceipt } from "./SubmitExpensePage";
import { useLocale } from "../../i18n/LocaleProvider";
import "./SubmitExpensePage.css";
import "./TripCostPage.css";

// Gas, toll and delivery receipts have no request to match. A General Manager or Project
// Manager scans the receipt, says what it was for and ticks the projects the trip served;
// the server splits the total evenly and each project's Project Manager approves their share.
// A Project Manager can charge the Active projects they manage; a General Manager any Active project.

const REASONS = [
  { value: "Gas", labelKey: "tc.reason_gas" },
  { value: "Toll", labelKey: "tc.reason_toll" },
  { value: "Delivery", labelKey: "tc.reason_delivery" },
  { value: "Other", labelKey: "tc.reason_other" },
];

const peso = (value) =>
  `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const newReceiptId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : null);

/** Render the scan, reason, project checklist and submit flow for a gas / toll / delivery receipt. */
export function TripCostPage() {
  const { user } = useAuth();
  const { t } = useLocale();
  const cameraInput = useRef(null);
  const imageInput = useRef(null);
  const pdfInput = useRef(null);
  const busyRef = useRef(false);
  // One id per receipt, kept across retries, so a lost response cannot save it twice.
  const receiptIdRef = useRef(newReceiptId());

  const [draft, setDraft] = useState({ ...EMPTY_DRAFT, lineItems: [] });
  const [receiptName, setReceiptName] = useState("");
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pageError, setPageError] = useState("");
  const [ocrNotice, setOcrNotice] = useState("");
  const [reason, setReason] = useState("Gas");
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

  /** Validate and scan a selected receipt, replacing the draft. */
  async function handleReceiptPick(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busyRef.current) return;

    setPageError("");
    setOcrNotice("");
    setReceiptName("");
    setResult(null);
    if (!isSupportedReceipt(file)) {
      setPageError(t("errors.receipt_type"));
      return;
    }

    setReceiptName(file.name);
    busyRef.current = true;
    setScanning(true);
    try {
      const scan = await scanReceipt(file);
      setDraft({ ...draftFromScan(scan), category: "Other" });
      setOcrNotice(scan.ocrError || (scan.confidence === "low" ? t("split.ocr_low") : ""));
    } catch (error) {
      setPageError(extractErrorMessage(error, t("errors.upload_failed")));
    } finally {
      busyRef.current = false;
      setScanning(false);
    }
  }

  function toggleProject(id) {
    setPicked((current) => (current.includes(id) ? current.filter((p) => p !== id) : [...current, id]));
  }

  const total = Number(draft.amount);
  const totalOk = draft.amount !== "" && Number.isFinite(total) && total > 0;
  const each = useMemo(() => (picked.length > 0 && totalOk ? total / picked.length : 0), [picked, total, totalOk]);
  const canSubmit = Boolean(
    draft.receiptImageURL && draft.vendorName.trim() && draft.receiptDate && totalOk && picked.length > 0 && !scanning && !submitting && !result
  );

  /** Send the trip cost once; a retry reuses the same receipt id. */
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
        note: note.trim() || undefined,
        commonReceiptID: receiptIdRef.current ?? undefined,
      });
      setResult(saved);
    } catch (error) {
      // 404: an older backend without the trip-cost route.
      const text = error?.response?.status === 404 ? t("tc.server_old") : extractErrorMessage(error, t("tc.failed"));
      setPageError(text);
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  }

  /** Clear the finished result and the receipt for another trip cost. */
  function startOver() {
    setResult(null);
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
      <div className="submit-expense-page">
        <div className="submit-expense-header">
          <div>
            <h1>{t("tc.saved_title")}</h1>
            <p className="submit-expense-subtitle">{t("tc.saved_subtitle", { count: result.expenses.length })}</p>
          </div>
        </div>
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
    <div className="submit-expense-page">
      <LoadingOverlay
        open={scanning || submitting}
        message={scanning ? t("submit.reading") : t("split.submitting")}
        detail={scanning ? t("submit.scan_detail") : t("split.creating")}
      />
      <div className="submit-expense-header">
        <div>
          <BackLink to="/expenses">{t("submit.back")}</BackLink>
          <h1>{t("tc.title")}</h1>
          <p className="submit-expense-subtitle">{t("tc.help")}</p>
        </div>
        <span className="submit-expense-role">{user.role}</span>
      </div>

      {pageError && <Banner tone="error" title={t("submit.could_not_continue")}>{pageError}</Banner>}
      {ocrNotice && <Banner tone="warning" title={t("submit.review_carefully")}>{ocrNotice}</Banner>}

      <Card className="submit-expense-card">
        <section className="submit-expense-section" aria-labelledby="trip-receipt-heading">
          <div className="submit-expense-section-heading">
            <div>
              <h2 id="trip-receipt-heading">{t("submit.step1_title")}</h2>
              <p>{t("tc.step1_help")}</p>
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
          </div>

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

      <Card className="submit-expense-card">
        <section className="submit-expense-section" aria-labelledby="trip-details-heading">
          <div className="submit-expense-section-heading">
            <div>
              <h2 id="trip-details-heading">{t("tc.step2_title")}</h2>
              <p>{t("tc.step2_help")}</p>
            </div>
          </div>

          <div className="submit-expense-fields">
            <Field label={t("submit.vendor_name")} required value={draft.vendorName} onChange={(e) => setField("vendorName", e.target.value)} />
            <Field label={t("submit.receipt_total")} required type="number" min="0" step="0.01" value={draft.amount} onChange={(e) => setField("amount", e.target.value)} />
            <Field label={t("my_expenses.receipt_date")} required type="date" value={draft.receiptDate} onChange={(e) => setField("receiptDate", e.target.value)} />
            <Field as="select" label={t("tc.reason_title")} required value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => <option key={r.value} value={r.value}>{t(r.labelKey)}</option>)}
            </Field>
            <Field label="TIN" value={draft.tin} onChange={(e) => setField("tin", e.target.value)} />
            <Field label={t("submit.field_bir_permit")} value={draft.birPermitNumber} onChange={(e) => setField("birPermitNumber", e.target.value)} />
            <Field label="OR / SI number" value={draft.birNumber} onChange={(e) => setField("birNumber", e.target.value)} />
          </div>
          <Field as="textarea" label={t("tc.note_label")} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </section>
      </Card>

      <Card className="submit-expense-card">
        <section className="submit-expense-section" aria-labelledby="trip-projects-heading">
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

          <div className="submit-expense-footer">
            <p>{picked.length === 0 ? t("tc.pick_project") : t("tc.footer_note")}</p>
            <Button type="button" disabled={!canSubmit} onClick={handleSubmit}>
              {submitting ? t("common.submitting") : totalOk ? t("tc.submit", { amount: peso(total) }) : t("tc.title")}
            </Button>
          </div>
        </section>
      </Card>
    </div>
  );
}
