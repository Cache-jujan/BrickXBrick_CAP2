import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { getContract, extractContractFile, saveContract, recordPayment, voidPayment } from "../../api/contractApi";
import { extractErrorMessage } from "../../api/client";
import { Badge } from "../../components/ui/Badge";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { BackLink } from "../../components/ui/BackLink";
import { useLocale } from "../../i18n/LocaleProvider";
import "./ContractPage.css";

// F2: the construction contract and the client's payments against it.
// Flow: the BOM is approved (the client agrees on the price) -> the GM records
// the signed contract -> the project can be activated.
//
// The contract is NOT the spending budget. The contract amount is what the
// client pays (normally the price agreed on the BOM); the project budget stays
// that price plus the escalation allowance. Payments are income: they show what
// was received, what is still to collect, and the cash position.
//
// GM: upload the .docx (values are proposed, nothing is saved), check every
// value, save. Record each payment received; a wrong one is voided, not deleted.
// The owning PM can read everything.

const PAYMENT_KINDS = ["Down Payment", "Progress Billing", "Retention"];
const CONTRACT_FIELDS = [
  "contractDate", "contractRef", "ownerName", "contractorName", "contractorRep", "contractorAddress",
  "scope", "siteLocation", "contractAmount", "downPaymentPercent", "retentionPercent",
  "durationWorkingDays", "warrantyMonths",
];

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

// The same split the server makes, shown while the GM types.
function previewSchedule(form) {
  const total = Number(form.contractAmount);
  if (!Number.isFinite(total) || total <= 0) return null;
  const down = round2((total * (Number(form.downPaymentPercent) || 0)) / 100);
  const retention = round2((total * (Number(form.retentionPercent) || 0)) / 100);
  return { total, down, retention, billings: round2(total - down - retention) };
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
      .then((resp) => {
        if (cancelled) return;
        setData(resp);
        if (!resp.contract && resp.canEdit) setForm(toForm(resp.prefill));
      })
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
    } catch (err) {
      const body = err?.response?.data;
      const details = body?.errors;
      if (Array.isArray(details)) setFieldErrors(Object.fromEntries(details.map((e) => [e.field, e.message])));
      if (body?.code === "CONFIRM_DIFFERENCE") {
        setDifferenceWarnings(body.warnings || []);
        setConfirmChecked(false);
      }
      setActionError(extractErrorMessage(err, fallback));
    } finally {
      setBusy("");
    }
  }

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

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
    await run("extract", async () => {
      const result = await extractContractFile(id, file);
      // The document's values go on top of what the form already holds (the prefill).
      setForm((f) => {
        const fromDoc = toForm(result.fields);
        return Object.fromEntries(CONTRACT_FIELDS.map((key) => [key, fromDoc[key] !== "" ? fromDoc[key] : f[key]]));
      });
      setFlags(result.flags || []);
      setReadFileName(result.fileName);
      setDifferenceWarnings([]);
      setConfirmChecked(false);
      setMode("form");
    }, t("contract.read_failed"));
  }

  async function handleSave() {
    await run("save", async () => {
      const resp = await saveContract(id, toPayload(form, readFileName), confirmChecked);
      setData(resp);
      setMode("view");
      setFlags([]);
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
      amount: kind === "Down Payment" ? String(summary.downPaymentAmount) : "",
      receivedOn: manilaToday(),
      referenceNo: "",
      workDonePercent: summary.workDonePercent === null ? "" : String(summary.workDonePercent),
      note: "",
    });
    setDialog("payment");
  }

  function changeKind(kind) {
    setPayForm((p) => ({
      ...p,
      kind,
      amount: kind === "Down Payment" && !p.amount ? String(data.summary.downPaymentAmount) : p.amount,
    }));
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
      <div className="contract-page">
        <Banner tone="info" title={t("contract.no_access_title")}>{t("contract.no_access_body")}</Banner>
        <BackLink to="/projects">{t("projects.back")}</BackLink>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="contract-page">
        <Banner tone="error" title={loadError} />
        <BackLink to={`/projects/${id}`}>{t("projects.back_one")}</BackLink>
      </div>
    );
  }

  const { contract, summary, payments } = data;
  const preview = previewSchedule(form);
  const hasLiveRetention = (payments || []).some((p) => !p.voidedAt && p.kind === "Retention");
  const kindOptions = PAYMENT_KINDS.filter((k) => k !== "Retention" || data.projectStatus === "Completed");

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
    <div className="contract-page">
      <BackLink to={`/projects/${id}`}>{t("projects.back_one")}</BackLink>

      <header className="contract-header">
        <div>
          <h1>{t("contract.title")}</h1>
          <p className="contract-sub">{data.projectName}</p>
        </div>
        <Badge status={data.projectStatus} />
      </header>

      {notice && <Banner tone="success" title={notice} />}
      {actionError && !dialog && <Banner tone="error" title={actionError} />}

      {/* ---- No contract yet ---- */}
      {!contract && mode === "view" && (
        <section className="contract-empty">
          <h2>{t("contract.none_title")}</h2>
          <p>{data.canEdit ? t("contract.none_gm") : t("contract.none_other")}</p>
          {data.canEdit && (
            <div className="contract-empty-actions">
              <input
                ref={fileInput}
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                hidden
                onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }}
              />
              <Button onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}>
                {busy === "extract" ? t("contract.reading") : t("contract.upload")}
              </Button>
              <Button variant="secondary" onClick={() => startForm(data.prefill)} disabled={Boolean(busy)}>
                {t("contract.enter_by_hand")}
              </Button>
            </div>
          )}
        </section>
      )}

      {/* ---- The form ---- */}
      {mode === "form" && (
        <section className="contract-card" aria-labelledby="contract-form-title">
          <h2 id="contract-form-title">{contract ? t("contract.edit") : t("contract.record")}</h2>
          {readFileName && <p className="contract-read-note">{t("contract.read_from", { file: readFileName })}. {t("contract.read_note")}</p>}
          {flags.length > 0 && (
            <ul className="contract-flags" aria-label={t("contract.flags_title")}>
              {flags.map((f, i) => (
                <li key={i} className={`contract-flag contract-flag-${f.level}`}>{f.message}</li>
              ))}
            </ul>
          )}
          <p className="contract-price-note">
            {data.agreedPrice !== null
              ? t("contract.price_note", { price: peso(data.agreedPrice) })
              : t("contract.price_note_no_bom")}
          </p>
          <div className="contract-grid">
            {textField("ownerName", "contract.owner", { required: true, maxLength: 150 })}
            {textField("contractorName", "contract.contractor", { required: true, maxLength: 150 })}
            {textField("contractorRep", "contract.contractor_rep", { maxLength: 150 })}
            {textField("contractorAddress", "contract.contractor_address", { maxLength: 255 })}
            {textField("scope", "contract.scope", { maxLength: 255 })}
            {textField("siteLocation", "contract.site", { maxLength: 255 })}
            {textField("contractDate", "contract.date", { required: true, type: "date", max: manilaToday() })}
            {textField("contractRef", "contract.ref", { maxLength: 100 })}
            {textField("contractAmount", "contract.amount", { required: true, type: "number", min: "0", step: "0.01", inputMode: "decimal", prefix: "₱" })}
            {textField("downPaymentPercent", "contract.down_pct", { required: true, type: "number", min: "0", max: "100", step: "0.01", inputMode: "decimal" })}
            {textField("retentionPercent", "contract.retention_pct", { required: true, type: "number", min: "0", max: "100", step: "0.01", inputMode: "decimal" })}
            {textField("durationWorkingDays", "contract.duration", { type: "number", min: "1", step: "1", inputMode: "numeric" })}
            {textField("warrantyMonths", "contract.warranty", { type: "number", min: "1", step: "1", inputMode: "numeric" })}
          </div>

          {preview && (
            <dl className="contract-preview" aria-label={t("contract.preview_title")}>
              <div><dt>{t("contract.down_payment")}</dt><dd className="num">{peso(preview.down)}</dd></div>
              <div><dt>{t("contract.progress_billings")}</dt><dd className="num">{peso(preview.billings)}</dd></div>
              <div><dt>{t("contract.retention")}</dt><dd className="num">{peso(preview.retention)}</dd></div>
            </dl>
          )}

          {differenceWarnings.length > 0 && (
            <div className="contract-confirm">
              <ul className="contract-flags">
                {differenceWarnings.map((w, i) => <li key={i} className="contract-flag contract-flag-warning">{w.message}</li>)}
              </ul>
              <label className="contract-confirm-check">
                <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} />
                {t("contract.confirm_difference")}
              </label>
            </div>
          )}

          <div className="contract-actions">
            <Button variant="secondary" onClick={() => setMode("view")} disabled={Boolean(busy)}>{t("contract.cancel")}</Button>
            <Button onClick={handleSave} disabled={Boolean(busy) || (differenceWarnings.length > 0 && !confirmChecked)}>
              {busy === "save" ? t("contract.saving") : t("contract.save")}
            </Button>
          </div>
        </section>
      )}

      {/* ---- The recorded contract ---- */}
      {contract && mode === "view" && (
        <>
          <section className="contract-card" aria-labelledby="contract-details-title">
            <div className="contract-card-head">
              <h2 id="contract-details-title">{t("contract.section_contract")}</h2>
              {data.canEdit && (
                <Button variant="secondary" className="btn-sm" onClick={() => startForm(contract)}>{t("contract.edit")}</Button>
              )}
            </div>
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
            <p className="contract-recorded">
              {t("contract.recorded_by", { name: contract.createdByName, date: formatDate(contract.createdAt, { dateStyle: "medium" }) })}
            </p>
          </section>

          <section className="contract-card" aria-labelledby="contract-schedule-title">
            <h2 id="contract-schedule-title">{t("contract.section_schedule")}</h2>
            <p className="contract-price-note">{t("contract.income_note")}</p>
            <dl className="contract-stats">
              <div><dt>{t("contract.amount")}</dt><dd className="num contract-stat-main">{peso(summary.contractAmount)}</dd></div>
              <div>
                <dt>{t("contract.down_payment")} ({contract.downPaymentPercent}%)</dt>
                <dd className="num">{peso(summary.downPaymentAmount)}</dd>
              </div>
              <div><dt>{t("contract.progress_billings")}</dt><dd className="num">{peso(summary.progressBillingsAmount)}</dd></div>
              <div>
                <dt>{t("contract.retention")} ({contract.retentionPercent}%)</dt>
                <dd className="num">{peso(summary.retentionAmount)}</dd>
                <dd className="contract-stat-note">{t("contract.retention_note")}</dd>
              </div>
            </dl>
          </section>

          <section className="contract-card" aria-labelledby="contract-ledger-title">
            <div className="contract-card-head">
              <h2 id="contract-ledger-title">{t("contract.section_ledger")}</h2>
              {data.canRecordPayments && <Button className="btn-sm" onClick={openPayment}>{t("contract.record_payment")}</Button>}
            </div>

            <dl className="contract-stats">
              <div>
                <dt>{t("contract.received")}</dt>
                <dd className="num contract-stat-main">{peso(summary.receivedTotal)}</dd>
                <dd className="contract-stat-note">{t("contract.percent_of_contract", { pct: summary.receivedPercent })}</dd>
              </div>
              <div><dt>{t("contract.to_collect")}</dt><dd className="num">{peso(summary.remainingToCollect)}</dd></div>
              <div>
                <dt>{t("contract.spent")}</dt>
                <dd className="num">{peso(summary.spentToDate)}</dd>
                {summary.workDonePercent !== null && <dd className="contract-stat-note">{t("contract.work_done", { pct: summary.workDonePercent })}</dd>}
              </div>
              <div>
                <dt>{t("contract.cash")}</dt>
                <dd className={`num ${summary.cashPosition < 0 ? "contract-negative" : ""}`}>{peso(summary.cashPosition)}</dd>
                <dd className="contract-stat-note">{t("contract.cash_note")}</dd>
              </div>
            </dl>

            {summary.warnings.map((w) => (
              <Banner key={w.code} tone={w.level === "warning" ? "warning" : "info"}>{w.message}</Banner>
            ))}

            {payments.length === 0 ? (
              <p className="contract-none">{t("contract.no_payments")}</p>
            ) : (
              <div className="table-scroll">
                <table className="contract-table">
                  <thead>
                    <tr>
                      <th>{t("contract.table_date")}</th>
                      <th>{t("contract.table_type")}</th>
                      <th className="num">{t("contract.table_amount")}</th>
                      <th className="num">{t("contract.table_work")}</th>
                      <th>{t("contract.table_ref")}</th>
                      <th>{t("contract.table_by")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
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
                        <td className="num">{peso(p.amount)}</td>
                        <td className="num">{p.workDonePercent === null ? "" : `${p.workDonePercent}%`}</td>
                        <td>{p.referenceNo || ""}</td>
                        <td>{p.recordedByName}</td>
                        <td>
                          {data.canRecordPayments && !p.voidedAt && (
                            <button type="button" className="contract-text-btn" onClick={() => openVoid(p)}>{t("contract.void")}</button>
                          )}
                          {p.voidedAt && <span className="contract-void-tag">{t("contract.voided")}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {/* ---- Dialogs ---- */}
      {dialog && (
        <div className="modal-overlay" role="presentation" onClick={() => !busy && setDialog(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="contract-dialog-title" onClick={(e) => e.stopPropagation()}>
            {dialog === "payment" && (
              <>
                <h2 id="contract-dialog-title" className="modal-title">{t("contract.payment_title")}</h2>
                <div className="contract-dialog-fields">
                  <label className="field">
                    <span className="field-label">{t("contract.pay_type")}<span className="field-required"> *</span></span>
                    <select className="field-control" value={payForm.kind} onChange={(e) => changeKind(e.target.value)}>
                      {kindOptions.map((k) => <option key={k} value={k}>{tv("contract.kind", k)}</option>)}
                    </select>
                    {data.projectStatus !== "Completed" && !hasLiveRetention && (
                      <span className="contract-hint">{t("contract.retention_locked")}</span>
                    )}
                  </label>
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
                  <Field
                    label={t("contract.pay_note")}
                    as="textarea"
                    maxLength={500}
                    value={payForm.note}
                    error={fieldErrors.note}
                    onChange={(e) => setPayForm((p) => ({ ...p, note: e.target.value }))}
                  />
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
