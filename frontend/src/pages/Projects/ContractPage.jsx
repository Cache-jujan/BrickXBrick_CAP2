import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getContract, extractContractFile, saveContract, recordPayment, voidPayment } from "../../api/contractApi";
import { extractErrorMessage } from "../../api/client";
import { Badge } from "../../components/ui/Badge";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { BackLink } from "../../components/ui/BackLink";
import { BomDropZone } from "../../components/bom/BomDropZone";
import { useLocale } from "../../i18n/LocaleProvider";
import "./BomPage.css"; // the contract page shares the BOM page's layout, totals strip and table
import "./ContractPage.css";

// F2: the construction contract and the client's payments against it.
// Flow: the BOM is approved (the client agrees on the price) -> the GM uploads the
// signed contract (.docx) -> the project can be activated.
//
// The contract is NOT the spending budget. The contract amount is what the client
// pays (normally the price agreed on the BOM); the project budget stays that price
// plus the escalation allowance. Payments are income: they show what was received,
// what is still to collect, and the cash position.
//
// GM: upload the .docx, check every value that was read, save. Record each payment
// received; a wrong one is voided, not deleted. The owning PM can read everything.

const PAYMENT_KINDS = ["Down Payment", "Progress Billing", "Retention"];
const CONTRACT_FIELDS = [
  "contractDate", "contractRef", "ownerName", "contractorName", "contractorRep", "contractorAddress",
  "scope", "siteLocation", "contractAmount", "downPaymentPercent", "retentionPercent",
  "durationWorkingDays", "warrantyMonths",
];
const DOCX = /\.docx$/i;

// Today in the Philippines as YYYY-MM-DD (a date received can't be later).
function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

const str = (v) => (v === null || v === undefined ? "" : String(v));
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function toForm(source) {
  return Object.fromEntries(CONTRACT_FIELDS.map((key) => [key, str(source?.[key])]));
}

// Blank optional values are left out so the server treats them as empty.
function toPayload(form, sourceFileName) {
  const payload = {};
  for (const key of CONTRACT_FIELDS) {
    const value = String(form[key] ?? "").trim();
    if (value !== "") payload[key] = value;
  }
  if (sourceFileName) payload.sourceFileName = sourceFileName;
  return payload;
}

// The same split the server makes, shown while the GM checks the values.
function previewSchedule(form) {
  const total = Number(form.contractAmount);
  if (!Number.isFinite(total) || total <= 0) return null;
  const down = round2((total * (Number(form.downPaymentPercent) || 0)) / 100);
  const retention = round2((total * (Number(form.retentionPercent) || 0)) / 100);
  return { total, down, retention, billings: round2(total - down - retention) };
}

// Expected, received and still-to-receive for one kind of payment (from the server's summary).
function kindFigures(summary, kind) {
  const expected =
    kind === "Down Payment" ? summary.downPaymentAmount
    : kind === "Retention" ? summary.retentionAmount
    : summary.progressBillingsAmount;
  const received = summary.receivedByKind?.[kind] ?? 0;
  return { expected, received, remaining: Math.max(round2(expected - received), 0) };
}

// What a payment's amount starts as. Progress billings follow the work done, so there is no fixed amount.
function startingAmount(summary, kind) {
  if (kind === "Progress Billing") return "";
  const { remaining } = kindFigures(summary, kind);
  return remaining > 0 ? String(remaining) : "";
}

function kindStatus(figures, kind, projectStatus) {
  if (figures.remaining <= 0.005) return "paid";
  if (kind === "Retention" && projectStatus !== "Completed") return "locked";
  return figures.received > 0 ? "partial" : "not_yet";
}

// The history reads like a ledger: oldest first, with what had been received after each payment
// and what was left of the contract. A voided payment stays listed but does not count.
function buildLedger(payments, contractAmount) {
  const ordered = [...payments].sort(
    (a, b) => a.receivedOn.localeCompare(b.receivedOn) || String(a.recordedAt).localeCompare(String(b.recordedAt))
  );
  let running = 0;
  return ordered.map((p) => {
    if (p.voidedAt) return { p, running: null, balance: null };
    running = round2(running + p.amount);
    return { p, running, balance: round2(contractAmount - running) };
  });
}

export function ContractPage() {
  const { id } = useParams();
  const { t, tv, formatDate, formatPeso } = useLocale();
  const peso = (value) => formatPeso(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fileInput = useRef(null);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);

  const [mode, setMode] = useState("view"); // "view" | "form"
  const [form, setForm] = useState(toForm(null));
  const [flags, setFlags] = useState([]);
  const [readFileName, setReadFileName] = useState("");
  const [readFailed, setReadFailed] = useState(false);
  const [differenceWarnings, setDifferenceWarnings] = useState([]);
  const [confirmChecked, setConfirmChecked] = useState(false);

  const [dialog, setDialog] = useState(null); // "payment" | "void"
  const [payForm, setPayForm] = useState({});
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState("");

  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    setAccessDenied(false);
    getContract(id)
      .then((resp) => { if (!cancelled) setData(resp); })
      .catch((err) => {
        if (cancelled) return;
        if (err?.response?.status === 403) setAccessDenied(true);
        else setLoadError(extractErrorMessage(err, t("contract.load_failed")));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // One wrapper for every server action: busy flag, field errors, the BOM-price confirmation.
  async function run(kind, fn, fallback) {
    setBusy(kind);
    setActionError("");
    setFieldErrors({});
    setNotice("");
    try {
      await fn();
      return true;
    } catch (err) {
      const body = err?.response?.data;
      const details = body?.errors;
      if (Array.isArray(details)) setFieldErrors(Object.fromEntries(details.map((e) => [e.field, e.message])));
      if (body?.code === "CONFIRM_DIFFERENCE") {
        setDifferenceWarnings(body.warnings || []);
        setConfirmChecked(false);
      }
      setActionError(extractErrorMessage(err, fallback));
      return false;
    } finally {
      setBusy("");
    }
  }

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function chooseFile() {
    fileInput.current?.click();
  }

  // Open the form for checking: with the values already saved, or (the manual fallback) the BOM prefill.
  function startForm(source) {
    setActionError("");
    setFieldErrors({});
    setFlags([]);
    setReadFileName("");
    setDifferenceWarnings([]);
    setConfirmChecked(false);
    setForm(toForm(source));
    setMode("form");
  }

  async function handleFile(file) {
    if (!file) return;
    setReadFailed(false);
    const ok = await run("extract", async () => {
      const result = await extractContractFile(id, file);
      // The document's values go on top of what is already known (the saved contract, or the BOM prefill).
      const base = toForm(data.contract || data.prefill);
      const fromDoc = toForm(result.fields);
      setForm(Object.fromEntries(CONTRACT_FIELDS.map((key) => [key, fromDoc[key] !== "" ? fromDoc[key] : base[key]])));
      setFlags(result.flags || []);
      setReadFileName(result.fileName);
      setDifferenceWarnings([]);
      setConfirmChecked(false);
      setMode("form");
    }, t("contract.read_failed"));
    if (!ok) setReadFailed(true);
  }

  async function handleSave() {
    await run("save", async () => {
      const resp = await saveContract(id, toPayload(form, readFileName), confirmChecked);
      setData(resp);
      setMode("view");
      setFlags([]);
      setReadFailed(false);
      setDifferenceWarnings([]);
      setNotice(t("contract.saved"));
    }, t("contract.save_failed"));
  }

  function openPayment() {
    const summary = data.summary;
    const hasDown = (data.payments || []).some((p) => !p.voidedAt && p.kind === "Down Payment");
    const kind = hasDown ? "Progress Billing" : "Down Payment";
    setActionError("");
    setFieldErrors({});
    setPayForm({
      kind,
      amount: startingAmount(summary, kind),
      receivedOn: manilaToday(),
      referenceNo: "",
      workDonePercent: summary.workDonePercent === null ? "" : String(summary.workDonePercent),
      note: "",
    });
    setDialog("payment");
  }

  function changeKind(kind) {
    setPayForm((p) => ({ ...p, kind, amount: startingAmount(data.summary, kind) }));
  }

  async function handlePayment() {
    await run("payment", async () => {
      const body = {
        kind: payForm.kind,
        amount: String(payForm.amount).trim(),
        receivedOn: payForm.receivedOn,
        referenceNo: payForm.referenceNo.trim() || undefined,
        note: payForm.note.trim() || undefined,
      };
      if (payForm.kind === "Progress Billing" && String(payForm.workDonePercent).trim() !== "") {
        body.workDonePercent = String(payForm.workDonePercent).trim();
      }
      setData(await recordPayment(id, body));
      setDialog(null);
      setNotice(t("contract.pay_saved"));
    }, t("contract.pay_failed"));
  }

  function openVoid(payment) {
    setActionError("");
    setFieldErrors({});
    setVoidTarget(payment);
    setVoidReason("");
    setDialog("void");
  }

  async function handleVoid() {
    await run("void", async () => {
      setData(await voidPayment(id, voidTarget.paymentId, voidReason.trim()));
      setDialog(null);
      setNotice(t("contract.voided_notice"));
    }, t("contract.void_failed"));
  }

  if (loading) return <p className="dashboard-loading">{t("contract.loading")}</p>;
  if (accessDenied) {
    return (
      <div className="bom-page">
        <Banner tone="info" title={t("contract.no_access_title")}>{t("contract.no_access_body")}</Banner>
        <BackLink to="/projects">{t("projects.back")}</BackLink>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="bom-page">
        <Banner tone="error" title={loadError} />
        <BackLink to={`/projects/${id}`}>{t("projects.back_one")}</BackLink>
      </div>
    );
  }

  const { contract, summary, payments } = data;
  const closed = data.projectStatus === "Cancelled";
  const preview = previewSchedule(form);
  const hasLiveRetention = (payments || []).some((p) => !p.voidedAt && p.kind === "Retention");
  const hasLiveDown = (payments || []).some((p) => !p.voidedAt && p.kind === "Down Payment");
  const scheduleRows = summary
    ? PAYMENT_KINDS.map((kind) => {
        const figures = kindFigures(summary, kind);
        return { kind, ...figures, status: kindStatus(figures, kind, data.projectStatus) };
      })
    : [];
  const ledger = summary ? buildLedger(payments, summary.contractAmount) : [];
  const payFigures = summary && dialog === "payment" ? kindFigures(summary, payForm.kind) : null;

  const dropText = {
    title: t("contract.drop_title"),
    orBrowse: t("contract.drop_or_browse"),
    release: t("contract.drop_release"),
    busy: t("contract.reading"),
    onlyType: t("contract.drop_only_docx"),
    aria: t("contract.drop_aria"),
  };

  const textField = (key, labelKey, extra = {}) => (
    <Field
      label={t(labelKey)}
      value={form[key]}
      error={fieldErrors[key]}
      onChange={(e) => setField(key, e.target.value)}
      {...extra}
    />
  );

  return (
    <div className="bom-page">
      <BackLink to={`/projects/${id}`}>{t("projects.back_one")}</BackLink>

      <header className="page-header">
        <div className="page-header-text">
          <div className="bom-title-row">
            <h1>{t("contract.title")}</h1>
            <Badge status={data.projectStatus} />
          </div>
          <p className="page-header-sub">
            <Link to={`/projects/${id}`}>{data.projectName}</Link>
            {contract?.sourceFileName && <> · {t("contract.from_file", { file: contract.sourceFileName })}</>}
          </p>
        </div>
        {mode === "view" && contract && data.canEdit && !closed && (
          <div className="page-header-actions">
            <Button variant="secondary" onClick={chooseFile} disabled={Boolean(busy)}>
              {busy === "extract" ? t("contract.reading") : t("contract.replace_file")}
            </Button>
            <Button variant="secondary" onClick={() => startForm(contract)} disabled={Boolean(busy)}>{t("contract.edit")}</Button>
            {data.canRecordPayments && <Button onClick={openPayment} disabled={Boolean(busy)}>{t("contract.record_payment")}</Button>}
          </div>
        )}
        {mode === "view" && contract && !data.canEdit && data.canRecordPayments && (
          <div className="page-header-actions">
            <Button onClick={openPayment}>{t("contract.record_payment")}</Button>
          </div>
        )}
      </header>

      <input
        ref={fileInput}
        type="file"
        className="visually-hidden"
        tabIndex={-1}
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }}
      />

      {notice && <Banner tone="success" title={notice} />}
      {actionError && !dialog && <Banner tone="error" title={actionError} />}

      {/* ---- No contract yet: upload only ---- */}
      {!contract && mode === "view" && (
        <div className="bom-empty">
          <h2>{t("contract.none_title")}</h2>
          {data.canEdit && !closed ? (
            <>
              <p>{t("contract.none_gm")}</p>
              <BomDropZone
                allowed={DOCX}
                text={dropText}
                busy={busy === "extract"}
                onFile={handleFile}
                onBrowse={chooseFile}
                onReject={setActionError}
              />
              {readFailed && (
                <div className="bom-empty-actions">
                  <Button variant="ghost" onClick={() => startForm(data.prefill)}>{t("contract.enter_by_hand")}</Button>
                </div>
              )}
            </>
          ) : (
            <p>{t("contract.none_other")}</p>
          )}
        </div>
      )}

      {/* ---- Checking what was read, before saving ---- */}
      {mode === "form" && (
        <>
          <p className="bom-status-line">
            {readFileName ? `${t("contract.read_from", { file: readFileName })}. ` : ""}
            {t("contract.read_note")}
          </p>

          {flags.length > 0 && (
            <section className="bom-checks" aria-labelledby="contract-flags-title">
              <h2 id="contract-flags-title" className="bom-checks-title">{t("contract.flags_title")}</h2>
              <ul className="bom-list">
                {flags.map((f, i) => (
                  <li key={i} className={f.level === "warning" ? "bom-check-warning" : "bom-check-info"}>{f.message}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="contract-card" aria-labelledby="contract-parties-title">
            <h2 id="contract-parties-title" className="bom-section-title">{t("contract.parties_title")}</h2>
            <div className="contract-grid">
              {textField("ownerName", "contract.owner", { required: true, maxLength: 150 })}
              {textField("contractorName", "contract.contractor", { required: true, maxLength: 150 })}
              {textField("contractorRep", "contract.contractor_rep", { maxLength: 150 })}
              {textField("contractorAddress", "contract.contractor_address", { maxLength: 255 })}
              {textField("scope", "contract.scope", { maxLength: 255 })}
              {textField("siteLocation", "contract.site", { maxLength: 255 })}
            </div>
          </section>

          <section className="contract-card" aria-labelledby="contract-terms-title">
            <h2 id="contract-terms-title" className="bom-section-title">{t("contract.terms_title")}</h2>
            <p className="contract-note">
              {data.agreedPrice !== null
                ? t("contract.price_note", { price: peso(data.agreedPrice) })
                : t("contract.price_note_no_bom")}
            </p>
            <div className="contract-grid">
              {textField("contractDate", "contract.date", { required: true, type: "date", max: manilaToday() })}
              {textField("contractRef", "contract.ref", { maxLength: 100 })}
              {textField("contractAmount", "contract.amount", { required: true, type: "number", min: "0", step: "0.01", inputMode: "decimal", prefix: "₱" })}
              {textField("downPaymentPercent", "contract.down_pct", { required: true, type: "number", min: "0", max: "100", step: "0.01", inputMode: "decimal" })}
              {textField("retentionPercent", "contract.retention_pct", { required: true, type: "number", min: "0", max: "100", step: "0.01", inputMode: "decimal" })}
              {textField("durationWorkingDays", "contract.duration", { type: "number", min: "1", step: "1", inputMode: "numeric" })}
              {textField("warrantyMonths", "contract.warranty", { type: "number", min: "1", step: "1", inputMode: "numeric" })}
            </div>
          </section>

          {preview && (
            <section className="bom-totals" aria-label={t("contract.preview_title")}>
              <div className="bom-total bom-total-main">
                <span className="bom-total-label">{t("contract.amount")}</span>
                <span className="bom-total-value">{peso(preview.total)}</span>
              </div>
              <div className="bom-total">
                <span className="bom-total-label">{t("contract.down_payment")}</span>
                <span className="bom-total-value">{peso(preview.down)}</span>
              </div>
              <div className="bom-total">
                <span className="bom-total-label">{t("contract.progress_billings")}</span>
                <span className="bom-total-value">{peso(preview.billings)}</span>
              </div>
              <div className="bom-total">
                <span className="bom-total-label">{t("contract.retention")}</span>
                <span className="bom-total-value">{peso(preview.retention)}</span>
              </div>
            </section>
          )}

          {differenceWarnings.length > 0 && (
            <section className="bom-checks" aria-labelledby="contract-diff-title">
              <h2 id="contract-diff-title" className="bom-checks-title">{t("contract.difference_title")}</h2>
              <ul className="bom-list">
                {differenceWarnings.map((w, i) => <li key={i} className="bom-check-warning">{w.message}</li>)}
              </ul>
              <label className="contract-confirm-check">
                <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} />
                {t("contract.confirm_difference")}
              </label>
            </section>
          )}

          <div className="contract-actions">
            <Button variant="secondary" onClick={() => setMode("view")} disabled={Boolean(busy)}>{t("contract.cancel")}</Button>
            <Button onClick={handleSave} disabled={Boolean(busy) || (differenceWarnings.length > 0 && !confirmChecked)}>
              {busy === "save" ? t("contract.saving") : t("contract.save")}
            </Button>
          </div>
        </>
      )}

      {/* ---- The recorded contract ---- */}
      {contract && mode === "view" && (
        <>
          <p className="bom-status-line">
            <strong className="bom-agreement">
              {t("contract.recorded_by", { name: contract.createdByName, date: formatDate(contract.createdAt, { dateStyle: "medium" }) })}.
            </strong>{" "}
            {t("contract.income_note")}
          </p>

          <section className="bom-totals" aria-label={t("contract.section_schedule")}>
            <div className="bom-total bom-total-main">
              <span className="bom-total-label">{t("contract.amount")}</span>
              <span className="bom-total-value">{peso(summary.contractAmount)}</span>
              <span className="bom-total-note">{t("contract.of_agreed_price")}</span>
            </div>
            <div className="bom-total">
              <span className="bom-total-label">{t("contract.down_payment")} ({contract.downPaymentPercent}%)</span>
              <span className="bom-total-value">{peso(summary.downPaymentAmount)}</span>
            </div>
            <div className="bom-total">
              <span className="bom-total-label">{t("contract.progress_billings")}</span>
              <span className="bom-total-value">{peso(summary.progressBillingsAmount)}</span>
              <span className="bom-total-note">{t("contract.billings_note")}</span>
            </div>
            <div className="bom-total">
              <span className="bom-total-label">{t("contract.retention")} ({contract.retentionPercent}%)</span>
              <span className="bom-total-value">{peso(summary.retentionAmount)}</span>
              <span className="bom-total-note">{t("contract.retention_note")}</span>
            </div>
          </section>

          <section className="contract-card" aria-labelledby="contract-details-title">
            <h2 id="contract-details-title" className="bom-section-title">{t("contract.section_contract")}</h2>
            <dl className="contract-details">
              <div><dt>{t("contract.owner")}</dt><dd>{contract.ownerName}</dd></div>
              <div><dt>{t("contract.contractor")}</dt><dd>{contract.contractorName}</dd></div>
              {contract.contractorRep && <div><dt>{t("contract.contractor_rep")}</dt><dd>{contract.contractorRep}</dd></div>}
              {contract.contractorAddress && <div><dt>{t("contract.contractor_address")}</dt><dd>{contract.contractorAddress}</dd></div>}
              {contract.scope && <div><dt>{t("contract.scope")}</dt><dd>{contract.scope}</dd></div>}
              {contract.siteLocation && <div><dt>{t("contract.site")}</dt><dd>{contract.siteLocation}</dd></div>}
              <div><dt>{t("contract.date")}</dt><dd>{formatDate(`${contract.contractDate}T00:00:00`, { dateStyle: "long" })}</dd></div>
              {contract.contractRef && <div><dt>{t("contract.ref_short")}</dt><dd>{contract.contractRef}</dd></div>}
              {contract.durationWorkingDays && <div><dt>{t("contract.duration")}</dt><dd>{t("contract.duration_value", { days: contract.durationWorkingDays })}</dd></div>}
              {contract.warrantyMonths && <div><dt>{t("contract.warranty")}</dt><dd>{t("contract.warranty_value", { months: contract.warrantyMonths })}</dd></div>}
            </dl>
          </section>

          <div className="section-head">
            <h2>{t("contract.section_ledger")}</h2>
          </div>

          <section className="bom-totals" aria-label={t("contract.section_ledger")}>
            <div className="bom-total bom-total-main">
              <span className="bom-total-label">{t("contract.received")}</span>
              <span className="bom-total-value">{peso(summary.receivedTotal)}</span>
              <span className="bom-total-note">{t("contract.percent_of_contract", { pct: summary.receivedPercent })}</span>
            </div>
            <div className="bom-total">
              <span className="bom-total-label">{t("contract.to_collect")}</span>
              <span className="bom-total-value">{peso(summary.remainingToCollect)}</span>
            </div>
            <div className="bom-total">
              <span className="bom-total-label">{t("contract.spent")}</span>
              <span className="bom-total-value">{peso(summary.spentToDate)}</span>
              {summary.workDonePercent !== null && (
                <span className="bom-total-note">{t("contract.work_done", { pct: summary.workDonePercent })}</span>
              )}
            </div>
            <div className="bom-total">
              <span className="bom-total-label">{t("contract.cash")}</span>
              <span className={`bom-total-value ${summary.cashPosition < 0 ? "contract-negative" : ""}`}>{peso(summary.cashPosition)}</span>
              <span className="bom-total-note">{t("contract.cash_note")}</span>
            </div>
          </section>

          {summary.warnings.length > 0 && (
            <section className="bom-checks" aria-labelledby="contract-notes-title">
              <h2 id="contract-notes-title" className="bom-checks-title">{t("contract.notes_title")}</h2>
              <ul className="bom-list">
                {summary.warnings.map((w) => (
                  <li key={w.code} className={w.level === "warning" ? "bom-check-warning" : "bom-check-info"}>{w.message}</li>
                ))}
              </ul>
            </section>
          )}

          <div className="section-head">
            <h2>{t("contract.schedule_title")}</h2>
          </div>
          <section className="contract-card" aria-label={t("contract.schedule_title")}>
            <div
              className="contract-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(summary.receivedPercent, 100)}
              aria-label={t("contract.bar_label", { received: peso(summary.receivedTotal), total: peso(summary.contractAmount), pct: summary.receivedPercent })}
            >
              <div className="contract-bar-fill" style={{ width: `${Math.min(summary.receivedPercent, 100)}%` }} />
            </div>
            <p className="contract-bar-text">
              {t("contract.bar_label", { received: peso(summary.receivedTotal), total: peso(summary.contractAmount), pct: summary.receivedPercent })}
            </p>
            <div className="table-scroll">
              <table className="bom-table">
                <thead>
                  <tr>
                    <th>{t("contract.table_type")}</th>
                    <th className="num">{t("contract.col_expected")}</th>
                    <th className="num">{t("contract.col_received")}</th>
                    <th className="num">{t("contract.col_remaining")}</th>
                    <th>{t("contract.col_status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduleRows.map((r) => (
                    <tr key={r.kind}>
                      <td>{tv("contract.kind", r.kind)}</td>
                      <td className="num">{peso(r.expected)}</td>
                      <td className="num">{peso(r.received)}</td>
                      <td className="num">{peso(r.remaining)}</td>
                      <td><span className={`contract-status contract-status-${r.status}`}>{t(`contract.status_${r.status}`)}</span></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>{t("contract.schedule_total")}</td>
                    <td className="num">{peso(summary.contractAmount)}</td>
                    <td className="num">{peso(summary.receivedTotal)}</td>
                    <td className="num">{peso(summary.remainingToCollect)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <div className="section-head">
            <h2>{t("contract.history_title")}</h2>
          </div>
          {ledger.length === 0 ? (
            <p className="bom-status-line">{t("contract.no_payments")}</p>
          ) : (
            <div className="table-scroll">
              <table className="bom-table">
                <thead>
                  <tr>
                    <th>{t("contract.table_date")}</th>
                    <th>{t("contract.table_type")}</th>
                    <th className="num">{t("contract.table_amount")}</th>
                    <th className="num">{t("contract.table_running")}</th>
                    <th className="num">{t("contract.table_balance")}</th>
                    <th className="num">{t("contract.table_work")}</th>
                    <th>{t("contract.table_ref")}</th>
                    <th>{t("contract.table_by")}</th>
                    <th className="bom-col-act"><span className="visually-hidden">{t("contract.void")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map(({ p, running, balance }) => (
                    <tr key={p.paymentId} className={p.voidedAt ? "contract-voided" : ""}>
                      <td>{formatDate(`${p.receivedOn}T00:00:00`, { dateStyle: "medium" })}</td>
                      <td>
                        {tv("contract.kind", p.kind)}
                        {p.note && <span className="contract-row-note">{p.note}</span>}
                        {p.voidedAt && (
                          <span className="contract-row-note">
                            {t("contract.voided_by", { name: p.voidedByName, reason: p.voidReason })}
                          </span>
                        )}
                      </td>
                      <td className="num contract-amount">{peso(p.amount)}</td>
                      <td className="num">{running === null ? "—" : peso(running)}</td>
                      <td className="num">{balance === null ? "—" : peso(balance)}</td>
                      <td className="num">{p.workDonePercent === null ? "" : `${p.workDonePercent}%`}</td>
                      <td>{p.referenceNo || ""}</td>
                      <td>{p.recordedByName}</td>
                      <td>
                        {data.canRecordPayments && !p.voidedAt && (
                          <button type="button" className="bom-text-btn bom-text-danger" onClick={() => openVoid(p)}>{t("contract.void")}</button>
                        )}
                        {p.voidedAt && <span className="contract-void-tag">{t("contract.voided")}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ---- Dialogs ---- */}
      {dialog && (
        <div className="modal-overlay" role="presentation" onClick={() => !busy && setDialog(null)}>
          <div className="modal contract-modal" role="dialog" aria-modal="true" aria-labelledby="contract-dialog-title" onClick={(e) => e.stopPropagation()}>
            {dialog === "payment" && payFigures && (
              <>
                <h2 id="contract-dialog-title" className="modal-title">{t("contract.payment_title")}</h2>
                <span className="field-label contract-kinds-label" id="contract-kind-label">{t("contract.pay_type")}</span>
                <div className="contract-kinds" role="radiogroup" aria-labelledby="contract-kind-label">
                  {PAYMENT_KINDS.map((k) => {
                    const lockedRetention = k === "Retention" && data.projectStatus !== "Completed" && !hasLiveRetention;
                    const recorded = (k === "Down Payment" && hasLiveDown) || (k === "Retention" && hasLiveRetention);
                    const disabled = lockedRetention || recorded;
                    return (
                      <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={payForm.kind === k}
                        disabled={disabled}
                        title={lockedRetention ? t("contract.retention_locked") : undefined}
                        className={`contract-kind ${payForm.kind === k ? "contract-kind-on" : ""}`}
                        onClick={() => changeKind(k)}
                      >
                        {tv("contract.kind", k)}
                        {lockedRetention && <small>{t("contract.status_locked")}</small>}
                        {recorded && <small>{t("contract.already_recorded")}</small>}
                      </button>
                    );
                  })}
                </div>
                <p className="contract-expect">
                  {t("contract.expected_line", {
                    expected: peso(payFigures.expected),
                    received: peso(payFigures.received),
                    remaining: peso(payFigures.remaining),
                  })}
                  {payForm.kind === "Progress Billing" && <span>{t("contract.progress_hint")}</span>}
                </p>
                <div className="contract-dialog-grid">
                  <Field
                    label={t("contract.pay_amount")}
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    prefix="₱"
                    value={payForm.amount}
                    error={fieldErrors.amount}
                    onChange={(e) => setPayForm((p) => ({ ...p, amount: e.target.value }))}
                  />
                  <Field
                    label={t("contract.pay_date")}
                    required
                    type="date"
                    max={manilaToday()}
                    value={payForm.receivedOn}
                    error={fieldErrors.receivedOn}
                    onChange={(e) => setPayForm((p) => ({ ...p, receivedOn: e.target.value }))}
                  />
                  <Field
                    label={t("contract.pay_ref")}
                    maxLength={100}
                    value={payForm.referenceNo}
                    error={fieldErrors.referenceNo}
                    onChange={(e) => setPayForm((p) => ({ ...p, referenceNo: e.target.value }))}
                  />
                  {payForm.kind === "Progress Billing" && (
                    <Field
                      label={t("contract.pay_work")}
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      inputMode="decimal"
                      value={payForm.workDonePercent}
                      error={fieldErrors.workDonePercent}
                      onChange={(e) => setPayForm((p) => ({ ...p, workDonePercent: e.target.value }))}
                    />
                  )}
                  <div className="contract-span">
                    <Field
                      label={t("contract.pay_note")}
                      as="textarea"
                      rows={2}
                      maxLength={500}
                      value={payForm.note}
                      error={fieldErrors.note}
                      onChange={(e) => setPayForm((p) => ({ ...p, note: e.target.value }))}
                    />
                  </div>
                </div>
              </>
            )}
            {dialog === "void" && (
              <>
                <h2 id="contract-dialog-title" className="modal-title">{t("contract.void_title")}</h2>
                <p className="modal-body">
                  {t("contract.void_body")} ({tv("contract.kind", voidTarget.kind)}, {peso(voidTarget.amount)})
                </p>
                <Field
                  label={t("contract.void_reason")}
                  required
                  as="textarea"
                  maxLength={500}
                  value={voidReason}
                  error={fieldErrors.reason}
                  onChange={(e) => setVoidReason(e.target.value)}
                />
              </>
            )}
            {actionError && <Banner tone="error" title={actionError} />}
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setDialog(null)} disabled={Boolean(busy)}>{t("contract.cancel")}</Button>
              {dialog === "payment" && (
                <Button onClick={handlePayment} disabled={Boolean(busy) || !String(payForm.amount).trim() || !payForm.receivedOn}>
                  {busy === "payment" ? t("contract.pay_saving") : t("contract.pay_save")}
                </Button>
              )}
              {dialog === "void" && (
                <Button variant="danger" onClick={handleVoid} disabled={Boolean(busy) || !voidReason.trim()}>
                  {busy === "void" ? t("contract.voiding") : t("contract.void_confirm")}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
