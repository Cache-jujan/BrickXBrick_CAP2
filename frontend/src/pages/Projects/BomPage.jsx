import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getBom, importBom, saveBom, approveBom, reopenBom, deleteBom } from "../../api/bomApi";
import { getProject } from "../../api/projectsApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Badge } from "../../components/ui/Badge";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { BackLink } from "../../components/ui/BackLink";
import { BudgetJustification } from "../../components/bom/BudgetJustification";
import { BomDropZone } from "../../components/bom/BomDropZone";
import { COST_CATEGORIES, DEFAULT_COST_CATEGORY, MAX_ESCALATION_PCT } from "../../utils/costCategories";
import { useLocale } from "../../i18n/LocaleProvider";
import "./BomPage.css";

// F2: the project's Bill of Materials.
// Client: the signed and sealed BOM is "the basis for every purchase and
// mobilization"; it arrives as an Excel file in the company format, and the
// price given to the client is the BOM total.
//
// GM: import the .xlsx (or enter it by hand), check it against the signed
// copy, fix mistakes, approve. Approved = locked; "Reopen" needs a reason.
// The owning PM can read it. Unit costs are never shown to SM or Purchaser.

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });
const QTY = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 });
const DATETIME_OPTIONS = { dateStyle: "medium", timeStyle: "short" };
const fmtDay = (iso, formatDate) => (iso ? formatDate(`${iso}T00:00:00`, { dateStyle: "medium" }) : "");

// Today in the Philippines as YYYY-MM-DD (the agreement date can't be later).
function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

// "Client agreed on Oct 3, 2026 (Maria Santos, Contract #2026-014)"
function agreementText(bom, t, formatDate) {
  if (!bom?.clientAgreedOn) return "";
  const who = [bom.clientAgreedBy, bom.agreementRef].filter(Boolean).join(", ");
  const date = fmtDay(bom.clientAgreedOn, formatDate);
  return who ? t("bom.agreed_on_by", { date, who }) : t("bom.agreed_on", { date });
}
const LABOR_OPTIONS = [
  { value: "rate", labelKey: "bom.labor_rate" },
  { value: "amount", labelKey: "bom.labor_amount" },
  { value: "included", labelKey: "bom.labor_included" },
  { value: "none", labelKey: "bom.labor_none" },
];

let keySeq = 0;
const nextKey = () => `k${(keySeq += 1)}`;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const numOrNaN = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));

function toDraft(bom) {
  return bom.sections.map((s) => ({
    key: nextKey(),
    sectionId: s.sectionId,
    name: s.name,
    subheading: s.subheading || "",
    costCategory: s.costCategory || DEFAULT_COST_CATEGORY,
    laborMode: s.laborMode,
    laborRatePct: s.laborRate != null ? String(round2(s.laborRate * 100)) : "",
    laborAmount: s.laborAmount != null ? String(s.laborAmount) : "",
    statedMaterialTotal: s.statedMaterialTotal,
    statedLaborAmount: s.statedLaborAmount,
    items: s.items.map((it) => ({
      key: nextKey(),
      bomItemId: it.bomItemId,
      description: it.description,
      quantity: String(it.quantity),
      unit: it.unit,
      unitCost: String(it.unitCost),
      inUse: it.inUse,
    })),
  }));
}

function toPayload(draft) {
  return draft.map((s) => ({
    sectionId: s.sectionId || undefined,
    name: s.name,
    subheading: s.subheading || null,
    costCategory: s.costCategory || DEFAULT_COST_CATEGORY,
    laborMode: s.laborMode,
    laborRate: s.laborMode === "rate" ? numOrNaN(s.laborRatePct) / 100 : null,
    laborAmount: s.laborMode === "amount" ? numOrNaN(s.laborAmount) : null,
    items: s.items.map((it) => ({
      bomItemId: it.bomItemId || undefined,
      description: it.description,
      quantity: numOrNaN(it.quantity),
      unit: it.unit,
      unitCost: numOrNaN(it.unitCost),
    })),
  }));
}

// Mirrors backend/src/lib/bomRules.js sectionTotals.
function sectionCalc(s) {
  const materials = round2(
    s.items.reduce((sum, it) => {
      const q = Number(it.quantity);
      const c = Number(it.unitCost);
      return sum + (Number.isFinite(q) && Number.isFinite(c) ? round2(q * c) : 0);
    }, 0)
  );
  let labor = 0;
  if (s.laborMode === "rate") labor = round2(materials * ((Number(s.laborRatePct) || 0) / 100));
  if (s.laborMode === "amount") labor = round2(Number(s.laborAmount) || 0);
  return { materials, labor, total: round2(materials + labor) };
}

function differs(a, b) {
  return b !== null && b !== undefined && Math.abs(Number(a) - Number(b)) > 0.005;
}

function emptySection() {
  return {
    key: nextKey(),
    sectionId: null,
    name: "",
    subheading: "",
    costCategory: DEFAULT_COST_CATEGORY,
    laborMode: "none",
    laborRatePct: "",
    laborAmount: "",
    statedMaterialTotal: null,
    statedLaborAmount: null,
    items: [emptyItem()],
  };
}

function emptyItem() {
  return { key: nextKey(), bomItemId: null, description: "", quantity: "", unit: "", unitCost: "", inUse: false };
}

export function BomPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const isGM = user.role === "General Manager";
  const { t, tv, formatDate } = useLocale();

  const [project, setProject] = useState(null);
  const [data, setData] = useState(null); // server response
  const [draft, setDraft] = useState(null); // editable copy of sections
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);

  const [busy, setBusy] = useState(""); // "import" | "save" | "approve" | "reopen" | "delete"
  const [actionError, setActionError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [importReport, setImportReport] = useState(null);
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState(null); // "approve" | "reopen" | "delete" | "replace"
  const [droppedFile, setDroppedFile] = useState(null); // dropped on the zone, waiting for the "replace?" answer
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [agreement, setAgreement] = useState({ clientAgreedOn: "", clientAgreedBy: "", agreementRef: "" });
  // Adviser item 6: escalation allowance as typed (percent) and its note.
  const [escalation, setEscalation] = useState({ ratePct: "5", note: "" });
  const fileInput = useRef(null);

  const applyResponse = useCallback((resp) => {
    setData(resp);
    setDraft(resp.bom ? toDraft(resp.bom) : null);
    if (resp.bom) {
      setEscalation({
        ratePct: String(Math.round((resp.bom.escalationRate || 0) * 10000) / 100),
        note: resp.bom.escalationNote || "",
      });
    }
    setDirty(false);
    setFieldErrors({});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getProject(id), getBom(id)])
      .then(([p, b]) => {
        if (cancelled) return;
        setProject(p);
        applyResponse(b);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err?.response?.status === 403) setAccessDenied(true);
        else setLoadError(extractErrorMessage(err, t("errors.load_bom")));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per project, not on a language change
  }, [id, applyResponse]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const bom = data?.bom || null;
  const projectClosed = ["Completed", "Cancelled", "Archived"].includes(data?.projectStatus);
  const editing = isGM && !projectClosed && Boolean(draft) && (!bom || bom.status === "Draft");

  const totals = useMemo(() => {
    if (!draft) return null;
    let materials = 0;
    let labor = 0;
    let items = 0;
    const byCategory = {};
    draft.forEach((s) => {
      const c = sectionCalc(s);
      materials += c.materials;
      labor += c.labor;
      items += s.items.length;
      const cat = s.costCategory || DEFAULT_COST_CATEGORY;
      byCategory[cat] = round2((byCategory[cat] || 0) + c.total);
    });
    return { materials: round2(materials), labor: round2(labor), total: round2(materials + labor), items, byCategory };
  }, [draft]);

  function update(fn) {
    setDraft((prev) => fn(structuredClone(prev)));
    setDirty(true);
    setNotice("");
  }

  const setSection = (si, patch) => update((d) => { Object.assign(d[si], patch); return d; });
  const setItem = (si, ii, patch) => update((d) => { Object.assign(d[si].items[ii], patch); return d; });
  const addItem = (si) => update((d) => { d[si].items.push(emptyItem()); return d; });
  const removeItem = (si, ii) => update((d) => { d[si].items.splice(ii, 1); return d; });
  const addSection = () => update((d) => { d.push(emptySection()); return d; });
  // "Add other cost": a non-material cost (fees, permits, transport...) as its
  // own section with a fixed amount and no items to buy (adviser item 6).
  const addOtherCost = ({ category, description, amount }) =>
    update((d) => {
      d.push({ ...emptySection(), name: description, costCategory: category, laborMode: "amount", laborAmount: String(amount), items: [] });
      return d;
    });
  function changeEscalation(patch) {
    setEscalation((e) => ({ ...e, ...patch }));
    setDirty(true);
    setNotice("");
  }
  const removeSection = (si) => update((d) => { d.splice(si, 1); return d; });
  const moveSection = (si, dir) =>
    update((d) => {
      const j = si + dir;
      if (j < 0 || j >= d.length) return d;
      [d[si], d[j]] = [d[j], d[si]];
      return d;
    });

  function startManual() {
    setDraft([emptySection()]);
    setDirty(true);
    setImportReport(null);
  }

  function discard() {
    if (bom) {
      setEscalation({ ratePct: String(Math.round((bom.escalationRate || 0) * 10000) / 100), note: bom.escalationNote || "" });
    }
    if (bom) setDraft(toDraft(bom));
    else setDraft(null);
    setDirty(false);
    setFieldErrors({});
    setActionError("");
  }

  async function run(kind, fn, fallback) {
    setBusy(kind);
    setActionError("");
    setNotice("");
    try {
      await fn();
    } catch (err) {
      const details = err?.response?.data?.errors;
      if (Array.isArray(details)) {
        setFieldErrors(Object.fromEntries(details.map((e) => [e.field, e.message])));
      }
      setActionError(extractErrorMessage(err, fallback));
    } finally {
      setBusy("");
    }
  }

  function chooseFile() {
    setDroppedFile(null);
    if (dirty || bom) {
      setDialog("replace");
      return;
    }
    fileInput.current?.click();
  }

  async function importFile(file) {
    await run("import", async () => {
      const resp = await importBom(id, file);
      applyResponse(resp);
      setImportReport(resp.importReport);
    }, t("errors.import_failed"));
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await importFile(file);
  }

  // A file dropped on the drop zone. A BOM or unsaved edits already on the page
  // get the same "replace?" question as the Replace button.
  function handleDrop(file) {
    if (dirty || bom) {
      setActionError("");
      setDroppedFile(file);
      setDialog("replace");
      return;
    }
    importFile(file);
  }

  async function handleSave() {
    await run("save", async () => {
      const pct = Number(escalation.ratePct);
      if (escalation.ratePct === "" || !Number.isFinite(pct) || pct < 0 || pct > MAX_ESCALATION_PCT) {
        throw new Error(t("errors.escalation_range", { max: MAX_ESCALATION_PCT }));
      }
      const resp = await saveBom(id, toPayload(draft), {
        escalationRate: Math.round(pct * 100) / 10000,
        escalationNote: escalation.note.trim(),
      });
      applyResponse(resp);
      // Keep the import report only while it lists rows that still need adding.
      setImportReport((r) => (r && r.skippedRows.length ? r : null));
      setNotice(t("bom.saved"));
    }, t("errors.save_bom"));
  }

  async function handleApprove() {
    await run("approve", async () => {
      const resp = await approveBom(id, confirmChecked, {
        clientAgreedOn: agreement.clientAgreedOn,
        clientAgreedBy: agreement.clientAgreedBy.trim(),
        agreementRef: agreement.agreementRef.trim() || undefined,
      });
      applyResponse(resp);
      setProject((p) => ({ ...p, budget: resp.projectBudget, bomstatus: "Approved" }));
      setImportReport(null);
      setDialog(null);
      setNotice(
        resp.previousBudget !== resp.projectBudget
          ? t("bom.approved_budget_changed", { new: PESO.format(resp.projectBudget), old: PESO.format(resp.previousBudget) })
          : t("bom.approved")
      );
    }, t("errors.approve_bom"));
  }

  async function handleReopen() {
    await run("reopen", async () => {
      const resp = await reopenBom(id, reopenReason.trim());
      applyResponse(resp);
      setProject((p) => ({ ...p, bomstatus: "Draft" }));
      setDialog(null);
      setReopenReason("");
    }, t("errors.reopen_bom"));
  }

  async function handleDelete() {
    await run("delete", async () => {
      await deleteBom(id);
      applyResponse({ ...data, bom: null });
      setImportReport(null);
      setDialog(null);
    }, t("errors.remove_bom"));
  }

  function openDialog(kind) {
    setActionError("");
    setFieldErrors({});
    setConfirmChecked(false);
    setDialog(kind);
  }

  if (loading) return <p className="dashboard-loading">{t("bom.loading")}</p>;
  if (accessDenied) {
    return (
      <div className="bom-page">
        <Banner tone="info" title={t("bom.no_access_title")}>
          {t("bom.no_access_body")}
        </Banner>
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

  const warnings = (bom?.warnings || []).filter((w) => w.level === "warning");
  const infos = (bom?.warnings || []).filter((w) => w.level === "info");
  const statedTotal = bom?.statedTotal ?? null;
  const fieldErr = (path) => fieldErrors[path];

  return (
    <div className="bom-page">
      <BackLink to={`/projects/${id}`}>{t("projects.back_one")}</BackLink>

      <header className="page-header">
        <div className="page-header-text">
          <div className="bom-title-row">
            <h1>{t("nav.bill_of_materials")}</h1>
            {bom && <Badge status={bom.status === "Approved" ? "Approved" : "Draft"} />}
          </div>
          <p className="page-header-sub">
            <Link to={`/projects/${id}`}>{project?.name}</Link>
            {bom?.sourceFileName && <> · {t("bom.from_file", { file: bom.sourceFileName })}</>}
          </p>
        </div>
        {isGM && !projectClosed && (
          <div className="page-header-actions">
            {(!bom || bom.status === "Draft") && (
              <Button variant="secondary" onClick={chooseFile} disabled={Boolean(busy)}>
                {busy === "import" ? t("bom.importing") : bom || draft ? t("bom.replace_excel") : t("bom.import_excel")}
              </Button>
            )}
            {editing && dirty && (
              <Button variant={bom ? "secondary" : "primary"} onClick={handleSave} disabled={Boolean(busy)}>
                {busy === "save" ? t("common.saving") : t("projects.save_changes")}
              </Button>
            )}
            {bom?.status === "Draft" && (
              <Button
                onClick={() => openDialog("approve")}
                disabled={Boolean(busy) || dirty}
                title={dirty ? t("bom.save_first") : undefined}
              >
                {t("bom.approve_btn")}
              </Button>
            )}
            {bom?.status === "Approved" && (
              <Button variant="secondary" onClick={() => openDialog("reopen")} disabled={Boolean(busy)}>
                {t("bom.reopen_btn")}
              </Button>
            )}
          </div>
        )}
      </header>

      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="visually-hidden"
        onChange={handleFile}
        tabIndex={-1}
        aria-hidden="true"
      />

      {actionError && !dialog && <Banner tone="error" title={actionError} />}
      {notice && <Banner tone="success" title={notice} />}

      {isGM && !projectClosed && draft && (!bom || bom.status === "Draft") && (
        <BomDropZone compact onFile={handleDrop} onBrowse={chooseFile} onReject={setActionError} busy={busy === "import"} />
      )}

      {bom?.status === "Approved" && (
        <p className="bom-status-line">
          {bom.clientAgreedOn && <strong className="bom-agreement">{agreementText(bom, t, formatDate)}.</strong>}{" "}
          {bom.approvedByName
            ? t("bom.approved_line_by", { name: bom.approvedByName, date: formatDate(bom.approvedAt, DATETIME_OPTIONS) })
            : t("bom.approved_line", { date: formatDate(bom.approvedAt, DATETIME_OPTIONS) })}
        </p>
      )}
      {bom?.status === "Draft" && bom.revisionNote && (
        <Banner tone="warning" title={t("bom.reopened_title")}>
          {bom.revisionNote}
          {bom.reopenedAt ? ` (${bom.reopenedByName || "General Manager"}, ${formatDate(bom.reopenedAt, DATETIME_OPTIONS)})` : ""}.{" "}
          {t("bom.approve_again")}
        </Banner>
      )}
      {bom?.status === "Draft" && !bom.revisionNote && isGM && (
        <p className="bom-status-line">{t("bom.check_intro")}</p>
      )}

      {importReport && (
        <Banner
          tone={importReport.skippedRows.length ? "warning" : "success"}
          title={t("bom.imported_title", { items: bom?.totals.itemCount ?? 0, sections: bom?.totals.sectionCount ?? 0, file: importReport.fileName })}
        >
          {importReport.skippedRows.length > 0 && (
            <>
              {t("bom.skipped_intro")}
              <ul className="bom-list">
                {importReport.skippedRows.map((r) => (
                  <li key={r.row}>
                    {r.description
                      ? t("bom.skipped_row_desc", { row: r.row, description: r.description, reason: r.reason })
                      : t("bom.skipped_row", { row: r.row, reason: r.reason })}
                  </li>
                ))}
              </ul>
            </>
          )}
          {importReport.rowWarnings.length > 0 && (
            <ul className="bom-list">
              {importReport.rowWarnings.map((w) => <li key={`${w.row}-${w.message}`}>{w.message}</li>)}
            </ul>
          )}
        </Banner>
      )}

      {!draft && (
        <div className="bom-empty">
          <h2>{data?.bomPending ? t("bom.pending_title") : t("bom.none_title")}</h2>
          {isGM && !projectClosed ? (
            <>
              <p>{t("bom.import_help")}</p>
              <BomDropZone onFile={handleDrop} onBrowse={chooseFile} onReject={setActionError} busy={busy === "import"} />
              <div className="bom-empty-actions">
                <Button variant="ghost" onClick={startManual}>{t("bom.enter_by_hand")}</Button>
              </div>
            </>
          ) : (
            <p>
              {data?.bomPending ? t("bom.pending_gm") : t("bom.none_gm")}
            </p>
          )}
        </div>
      )}

      {draft && totals && (
        <>
          <section className="bom-totals" aria-label={t("bom.totals_aria")}>
            <div className="bom-total">
              <span className="bom-total-label">{t("bom.materials")}</span>
              <span className="bom-total-value">{PESO.format(totals.materials)}</span>
              <span className="bom-total-note">
                {t("bom.in_sections", {
                  items: totals.items === 1 ? t("bom.item_one") : t("bom.item_other", { count: totals.items }),
                  sections: draft.length === 1 ? t("bom.section_one") : t("bom.section_other", { count: draft.length }),
                })}
              </span>
            </div>
            <div className="bom-total">
              <span className="bom-total-label">{t("bom.labor_other")}</span>
              <span className="bom-total-value">{PESO.format(totals.labor)}</span>
              <span className="bom-total-note">{t("bom.labor_note")}</span>
            </div>
            <div className="bom-total bom-total-main">
              <span className="bom-total-label">{t("bomjust.bom_total")}</span>
              <span className="bom-total-value">{PESO.format(totals.total)}</span>
              <span className={"bom-total-note" + (differs(totals.total, statedTotal) ? " bom-mismatch" : "")}>
                {statedTotal === null
                  ? bom?.sourceFileName ? t("bom.no_total_file") : t("bom.entered_by_hand")
                  : differs(totals.total, statedTotal)
                    ? t("bom.file_says", { amount: PESO.format(statedTotal) })
                    : t("bom.matches_file")}
              </span>
            </div>
            <div className="bom-total">
              <span className="bom-total-label">{t("bom.target_budget_label")}</span>
              <span className="bom-total-value">{PESO.format(Number(project?.budget ?? data.projectBudget ?? 0))}</span>
              <span className="bom-total-note">
                {bom?.status === "Approved"
                  ? t("bom.agreed_plus", { pct: Math.round((bom.escalationRate || 0) * 10000) / 100 })
                  : t("bom.becomes", { pct: escalation.ratePct || 0 })}
              </span>
            </div>
          </section>

          <BudgetJustification
            byCategory={totals.byCategory}
            subtotal={totals.total}
            statedTotal={statedTotal}
            ratePct={escalation.ratePct}
            note={escalation.note}
            editing={editing}
            onRateChange={(v) => changeEscalation({ ratePct: v })}
            onNoteChange={(v) => changeEscalation({ note: v })}
            onAddCost={addOtherCost}
            rateError={fieldErr("escalationRate")}
          />

          {!dirty && (warnings.length > 0 || infos.length > 0) && (
            <section className="bom-checks" aria-labelledby="bom-checks-title">
              <h2 id="bom-checks-title" className="bom-checks-title">
                {!warnings.length
                  ? t("bom.notes")
                  : bom.status === "Approved"
                    ? t("bom.flagged_review", { count: warnings.length })
                    : t("bom.check_before", { count: warnings.length })}
              </h2>
              <ul className="bom-list">
                {warnings.map((w, i) => <li key={`w${i}`} className="bom-check-warning">{w.message}</li>)}
                {infos.map((w, i) => <li key={`i${i}`} className="bom-check-info">{w.message}</li>)}
              </ul>
            </section>
          )}
          {dirty && (
            <p className="bom-status-line">{t("bom.checks_updated")}</p>
          )}

          {draft.map((s, si) => {
            const c = sectionCalc(s);
            const matMismatch = differs(c.materials, s.statedMaterialTotal);
            const laborMismatch = s.laborMode !== "included" && differs(c.labor, s.statedLaborAmount);
            const p = `sections[${si}]`;
            return (
              <section key={s.key} className="bom-section" aria-label={s.name || t("bom.section_n", { n: si + 1 })}>
                <div className="bom-section-head">
                  {editing ? (
                    <div className="bom-section-names">
                      <input
                        className={"bom-input bom-input-name" + (fieldErr(`${p}.name`) ? " bom-input-error" : "")}
                        value={s.name}
                        placeholder={t("bom.section_name_ph")}
                        aria-label={t("bom.section_name")}
                        onChange={(e) => setSection(si, { name: e.target.value })}
                      />
                      <input
                        className="bom-input bom-input-sub"
                        value={s.subheading}
                        placeholder={t("bom.subheading_ph")}
                        aria-label={t("bom.subheading")}
                        onChange={(e) => setSection(si, { subheading: e.target.value })}
                      />
                      <select
                        className="bom-input bom-input-category"
                        value={s.costCategory || DEFAULT_COST_CATEGORY}
                        aria-label={t("bomjust.type_of_cost")}
                        onChange={(e) => setSection(si, { costCategory: e.target.value })}
                      >
                        {COST_CATEGORIES.map((c) => <option key={c} value={c}>{tv("costcat", c)}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <h2 className="bom-section-title">{s.name}</h2>
                      {s.subheading && <p className="bom-section-sub">{s.subheading}</p>}
                      <span className="bom-category">{tv("costcat", s.costCategory || DEFAULT_COST_CATEGORY)}</span>
                    </div>
                  )}
                  <div className="bom-section-side">
                    <span className="bom-section-total">{PESO.format(c.total)}</span>
                    {editing && (
                      <span className="bom-section-tools">
                        <button type="button" className="bom-icon-btn" onClick={() => moveSection(si, -1)} disabled={si === 0} aria-label={t("bom.move_up")}>↑</button>
                        <button type="button" className="bom-icon-btn" onClick={() => moveSection(si, 1)} disabled={si === draft.length - 1} aria-label={t("bom.move_down")}>↓</button>
                        <button
                          type="button"
                          className="bom-text-btn bom-text-danger"
                          onClick={() => removeSection(si)}
                          disabled={s.items.some((it) => it.inUse)}
                        >
                          {t("bom.remove_section")}
                        </button>
                      </span>
                    )}
                  </div>
                </div>

                <div className="table-scroll">
                  <table className="bom-table">
                    <thead>
                      <tr>
                        <th className="bom-col-no">#</th>
                        <th>{t("submit.description")}</th>
                        <th className="num bom-col-qty">{t("split.col_qty")}</th>
                        <th className="bom-col-unit">{t("bom.col_unit")}</th>
                        <th className="num bom-col-cost">{t("bom.col_unit_cost")}</th>
                        <th className="num bom-col-amount">{t("bom.col_cost")}</th>
                        {editing && <th className="bom-col-act"><span className="visually-hidden">{t("common.remove")}</span></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {s.items.map((it, ii) => {
                        const ip = `${p}.items[${ii}]`;
                        const cost = Number(it.quantity) * Number(it.unitCost);
                        return (
                          <tr key={it.key}>
                            <td className="bom-col-no">{ii + 1}</td>
                            {editing ? (
                              <>
                                <td>
                                  <input className={"bom-input" + (fieldErr(`${ip}.description`) ? " bom-input-error" : "")} value={it.description} aria-label={t("submit.description")}
                                    onChange={(e) => setItem(si, ii, { description: e.target.value })} />
                                </td>
                                <td className="num">
                                  <input className={"bom-input num" + (fieldErr(`${ip}.quantity`) ? " bom-input-error" : "")} type="number" min="0" step="any" inputMode="decimal" value={it.quantity} aria-label={t("bom.aria_quantity")}
                                    onChange={(e) => setItem(si, ii, { quantity: e.target.value })} />
                                </td>
                                <td>
                                  <input className={"bom-input" + (fieldErr(`${ip}.unit`) ? " bom-input-error" : "")} value={it.unit} aria-label={t("bom.col_unit")} disabled={it.inUse}
                                    title={it.inUse ? t("bom.unit_locked") : undefined}
                                    onChange={(e) => setItem(si, ii, { unit: e.target.value })} />
                                </td>
                                <td className="num">
                                  <input className={"bom-input num" + (fieldErr(`${ip}.unitCost`) ? " bom-input-error" : "")} type="number" min="0" step="any" inputMode="decimal" value={it.unitCost} aria-label={t("bom.col_unit_cost")}
                                    onChange={(e) => setItem(si, ii, { unitCost: e.target.value })} />
                                </td>
                              </>
                            ) : (
                              <>
                                <td>{it.description}</td>
                                <td className="num">{QTY.format(Number(it.quantity))}</td>
                                <td>{it.unit}</td>
                                <td className="num">{PESO.format(Number(it.unitCost))}</td>
                              </>
                            )}
                            <td className="num">{Number.isFinite(cost) ? PESO.format(round2(cost)) : "—"}</td>
                            {editing && (
                              <td className="bom-col-act">
                                <button type="button" className="bom-icon-btn" onClick={() => removeItem(si, ii)} disabled={it.inUse}
                                  aria-label={t("bom.remove_item_aria", { name: it.description || t("bom.item_word") })} title={it.inUse ? t("bom.item_in_use") : t("bom.remove_item")}>
                                  ×
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      {s.items.length === 0 && (
                        <tr>
                          <td colSpan={editing ? 7 : 6} className="bom-empty-row">
                            {c.labor > 0 ? t("bom.lump_sum_row") : t("bom.no_items")}
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={5}>
                          {s.laborMode === "included" ? t("bom.labor_material_cost") : t("bom.material_cost")}
                          {matMismatch && <span className="bom-mismatch">{t("bom.file_says_inline", { amount: PESO.format(s.statedMaterialTotal) })}</span>}
                        </td>
                        <td className="num">{PESO.format(c.materials)}</td>
                        {editing && <td />}
                      </tr>
                      <tr>
                        <td colSpan={5}>
                          <span className="bom-labor">
                            {s.items.length === 0 ? t("bom.lump_sum") : t("bom.labor")}
                            {editing ? (
                              <>
                                <select className="bom-input bom-labor-mode" value={s.laborMode} aria-label={t("bom.labor_how")}
                                  onChange={(e) => setSection(si, { laborMode: e.target.value })}>
                                  {LABOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
                                </select>
                                {s.laborMode === "rate" && (
                                  <span className="bom-labor-input">
                                    <input className={"bom-input num" + (fieldErr(`${p}.laborRate`) ? " bom-input-error" : "")} type="number" min="0" step="any" value={s.laborRatePct} aria-label={t("bom.labor_percent")}
                                      onChange={(e) => setSection(si, { laborRatePct: e.target.value })} />%
                                  </span>
                                )}
                                {s.laborMode === "amount" && (
                                  <span className="bom-labor-input">
                                    ₱<input className={"bom-input num" + (fieldErr(`${p}.laborAmount`) ? " bom-input-error" : "")} type="number" min="0" step="any" value={s.laborAmount} aria-label={t("bom.labor_amount_aria")}
                                      onChange={(e) => setSection(si, { laborAmount: e.target.value })} />
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="bom-labor-desc">
                                {s.laborMode === "rate" && t("bom.labor_desc_rate", { pct: round2(Number(s.laborRatePct)) })}
                                {s.laborMode === "amount" && t("bom.labor_desc_amount")}
                                {s.laborMode === "included" && t("bom.labor_desc_included")}
                                {s.laborMode === "none" && t("bom.labor_desc_none")}
                              </span>
                            )}
                          </span>
                          {laborMismatch && <span className="bom-mismatch">{t("bom.file_says_inline", { amount: PESO.format(s.statedLaborAmount) })}</span>}
                        </td>
                        <td className="num">{s.laborMode === "included" ? "—" : PESO.format(c.labor)}</td>
                        {editing && <td />}
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {editing && (
                  <button type="button" className="bom-text-btn" onClick={() => addItem(si)}>+ {t("common.add_item")}</button>
                )}
              </section>
            );
          })}

          {editing && (
            <div className="bom-bottom-actions">
              <Button variant="secondary" onClick={addSection}>{t("bom.add_section")}</Button>
              {bom && data.projectStatus === "Draft" && !dirty && (
                <button type="button" className="bom-text-btn bom-text-danger" onClick={() => openDialog("delete")}>
                  {t("bom.remove_this")}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {editing && dirty && (
        <div className="bom-savebar" role="region" aria-label={t("bom.unsaved")}>
          <span>{t("bom.unsaved")}</span>
          <div className="bom-savebar-actions">
            <Button variant="secondary" onClick={discard} disabled={Boolean(busy)}>{t("bom.discard")}</Button>
            <Button onClick={handleSave} disabled={Boolean(busy)}>{busy === "save" ? t("common.saving") : t("projects.save_changes")}</Button>
          </div>
        </div>
      )}

      {dialog && (
        <div className="modal-overlay" role="presentation" onClick={() => !busy && setDialog(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="bom-dialog-title" onClick={(e) => e.stopPropagation()}>
            {dialog === "approve" && (
              <>
                <h2 id="bom-dialog-title" className="modal-title">{t("bom.approve_title")}</h2>
                <p className="modal-body">
                  {t("bom.approve_body_1")} {t("bom.target_becomes")}{" "}
                  {bom.statedTotal !== null ? t("bom.basis_signed") : t("bom.basis_total")}
                  {bom.budget?.escalationAllowance > 0
                    ? ` ${t("bom.plus_allowance", { pct: Math.round(bom.budget.escalationRate * 10000) / 100 })}`
                    : ""}
                  , <strong>{PESO.format(bom.budgetOnApproval ?? bom.totals.total)}</strong>
                  {Number(data.projectBudget) !== (bom.budgetOnApproval ?? bom.totals.total)
                    ? ` ${t("bom.now_budget", { amount: PESO.format(Number(data.projectBudget)) })}`
                    : ""}.
                </p>
                <p className="bom-agreement-intro">{t("bom.agreement_intro")}</p>
                <div className="bom-agreement-fields">
                  <Field
                    label={t("bom.date_agreed")}
                    required
                    type="date"
                    max={manilaToday()}
                    value={agreement.clientAgreedOn}
                    error={fieldErrors.clientAgreedOn}
                    onChange={(e) => setAgreement((a) => ({ ...a, clientAgreedOn: e.target.value }))}
                  />
                  <Field
                    label={t("bom.who_agreed")}
                    required
                    placeholder={t("bom.who_ph")}
                    maxLength={150}
                    value={agreement.clientAgreedBy}
                    error={fieldErrors.clientAgreedBy}
                    onChange={(e) => setAgreement((a) => ({ ...a, clientAgreedBy: e.target.value }))}
                  />
                  <Field
                    label={t("bom.ref_label")}
                    placeholder={t("bom.ref_ph")}
                    maxLength={100}
                    value={agreement.agreementRef}
                    error={fieldErrors.agreementRef}
                    onChange={(e) => setAgreement((a) => ({ ...a, agreementRef: e.target.value }))}
                  />
                </div>
                {warnings.length > 0 && (
                  <>
                    <ul className="bom-list bom-dialog-list">
                      {warnings.map((w, i) => <li key={i}>{w.message}</li>)}
                    </ul>
                    <label className="bom-confirm">
                      <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} />
                      {t("bom.checked_signed")}
                    </label>
                  </>
                )}
              </>
            )}
            {dialog === "reopen" && (
              <>
                <h2 id="bom-dialog-title" className="modal-title">{t("bom.reopen_title")}</h2>
                <p className="modal-body">{t("bom.reopen_body")}</p>
                <Field label={t("bom.reason")} required as="textarea" placeholder={t("bom.reason_ph")}
                  value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
              </>
            )}
            {dialog === "delete" && (
              <>
                <h2 id="bom-dialog-title" className="modal-title">{t("bom.delete_title")}</h2>
                <p className="modal-body">{t("bom.delete_body")}</p>
              </>
            )}
            {dialog === "replace" && (
              <>
                <h2 id="bom-dialog-title" className="modal-title">{t("bom.replace_title")}</h2>
                <p className="modal-body">
                  {droppedFile ? t("bom.replace_dropped_body", { file: droppedFile.name }) : t("bom.replace_body")}
                </p>
              </>
            )}
            {actionError && <Banner tone="error" title={actionError} />}
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => { setDialog(null); setDroppedFile(null); }} disabled={Boolean(busy)}>{t("bom.back")}</Button>
              {dialog === "approve" && (
                <Button
                  onClick={handleApprove}
                  disabled={
                    Boolean(busy) ||
                    (warnings.length > 0 && !confirmChecked) ||
                    !agreement.clientAgreedOn ||
                    agreement.clientAgreedBy.trim().length < 2
                  }
                >
                  {busy === "approve" ? t("bom.approving") : t("expenses.approve")}
                </Button>
              )}
              {dialog === "reopen" && (
                <Button onClick={handleReopen} disabled={Boolean(busy) || !reopenReason.trim()}>
                  {busy === "reopen" ? t("bom.reopening") : t("bom.reopen")}
                </Button>
              )}
              {dialog === "delete" && (
                <Button variant="danger" onClick={handleDelete} disabled={Boolean(busy)}>
                  {busy === "delete" ? t("bom.removing") : t("bom.remove")}
                </Button>
              )}
              {dialog === "replace" && (
                <Button
                  onClick={() => {
                    setDialog(null);
                    if (droppedFile) {
                      const file = droppedFile;
                      setDroppedFile(null);
                      importFile(file);
                    } else {
                      fileInput.current?.click();
                    }
                  }}
                >
                  {droppedFile ? t("bom.replace_with") : t("bom.choose_file")}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
