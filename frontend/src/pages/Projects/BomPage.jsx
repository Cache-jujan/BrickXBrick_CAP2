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
const DATETIME = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });
const LABOR_OPTIONS = [
  { value: "rate", label: "% of materials" },
  { value: "amount", label: "Fixed amount" },
  { value: "included", label: "Included in prices" },
  { value: "none", label: "No labor" },
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
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const fileInput = useRef(null);

  const applyResponse = useCallback((resp) => {
    setData(resp);
    setDraft(resp.bom ? toDraft(resp.bom) : null);
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
        else setLoadError(extractErrorMessage(err, "Couldn't load the Bill of Materials."));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
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
    draft.forEach((s) => {
      const c = sectionCalc(s);
      materials += c.materials;
      labor += c.labor;
      items += s.items.length;
    });
    return { materials: round2(materials), labor: round2(labor), total: round2(materials + labor), items };
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
    if (dirty || bom) {
      setDialog("replace");
      return;
    }
    fileInput.current?.click();
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await run("import", async () => {
      const resp = await importBom(id, file);
      applyResponse(resp);
      setImportReport(resp.importReport);
    }, "Couldn't import this file.");
  }

  async function handleSave() {
    await run("save", async () => {
      const resp = await saveBom(id, toPayload(draft));
      applyResponse(resp);
      // Keep the import report only while it lists rows that still need adding.
      setImportReport((r) => (r && r.skippedRows.length ? r : null));
      setNotice("Changes saved.");
    }, "Couldn't save the BOM.");
  }

  async function handleApprove() {
    await run("approve", async () => {
      const resp = await approveBom(id, confirmChecked);
      applyResponse(resp);
      setProject((p) => ({ ...p, budget: resp.projectBudget, bomstatus: "Approved" }));
      setImportReport(null);
      setDialog(null);
      setNotice(
        resp.previousBudget !== resp.projectBudget
          ? `BOM approved. The project budget is now ${PESO.format(resp.projectBudget)} (was ${PESO.format(resp.previousBudget)}).`
          : "BOM approved."
      );
    }, "Couldn't approve the BOM.");
  }

  async function handleReopen() {
    await run("reopen", async () => {
      const resp = await reopenBom(id, reopenReason.trim());
      applyResponse(resp);
      setProject((p) => ({ ...p, bomstatus: "Draft" }));
      setDialog(null);
      setReopenReason("");
    }, "Couldn't reopen the BOM.");
  }

  async function handleDelete() {
    await run("delete", async () => {
      await deleteBom(id);
      applyResponse({ ...data, bom: null });
      setImportReport(null);
      setDialog(null);
    }, "Couldn't remove the BOM.");
  }

  function openDialog(kind) {
    setActionError("");
    setConfirmChecked(false);
    setDialog(kind);
  }

  if (loading) return <p className="dashboard-loading">Loading Bill of Materials…</p>;
  if (accessDenied) {
    return (
      <div className="bom-page">
        <Banner tone="info" title="You don't manage this project">
          Only this project's Project Manager or a General Manager can view its Bill of Materials.
        </Banner>
        <BackLink to="/projects">Back to Projects</BackLink>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="bom-page">
        <Banner tone="error" title={loadError} />
        <BackLink to={`/projects/${id}`}>Back to project</BackLink>
      </div>
    );
  }

  const warnings = (bom?.warnings || []).filter((w) => w.level === "warning");
  const infos = (bom?.warnings || []).filter((w) => w.level === "info");
  const statedTotal = bom?.statedTotal ?? null;
  const fieldErr = (path) => fieldErrors[path];

  return (
    <div className="bom-page">
      <BackLink to={`/projects/${id}`}>Back to project</BackLink>

      <header className="page-header">
        <div className="page-header-text">
          <div className="bom-title-row">
            <h1>Bill of Materials</h1>
            {bom && <Badge status={bom.status === "Approved" ? "Approved" : "Draft"} />}
          </div>
          <p className="page-header-sub">
            <Link to={`/projects/${id}`}>{project?.name}</Link>
            {bom?.sourceFileName && <> · from {bom.sourceFileName}</>}
          </p>
        </div>
        {isGM && !projectClosed && (
          <div className="page-header-actions">
            {(!bom || bom.status === "Draft") && (
              <Button variant="secondary" onClick={chooseFile} disabled={Boolean(busy)}>
                {busy === "import" ? "Importing…" : bom || draft ? "Replace from Excel" : "Import from Excel"}
              </Button>
            )}
            {editing && dirty && (
              <Button variant={bom ? "secondary" : "primary"} onClick={handleSave} disabled={Boolean(busy)}>
                {busy === "save" ? "Saving…" : "Save changes"}
              </Button>
            )}
            {bom?.status === "Draft" && (
              <Button
                onClick={() => openDialog("approve")}
                disabled={Boolean(busy) || dirty}
                title={dirty ? "Save your changes first" : undefined}
              >
                Approve BOM
              </Button>
            )}
            {bom?.status === "Approved" && (
              <Button variant="secondary" onClick={() => openDialog("reopen")} disabled={Boolean(busy)}>
                Reopen for revision
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

      {bom?.status === "Approved" && (
        <p className="bom-status-line">
          Approved{bom.approvedByName ? ` by ${bom.approvedByName}` : ""} on {DATETIME.format(new Date(bom.approvedAt))}.
          It is locked; material requests use these items.
        </p>
      )}
      {bom?.status === "Draft" && bom.revisionNote && (
        <Banner tone="warning" title="Reopened for revision">
          {bom.revisionNote}
          {bom.reopenedAt ? ` (${bom.reopenedByName || "General Manager"}, ${DATETIME.format(new Date(bom.reopenedAt))})` : ""}.
          Approve it again when the changes are done.
        </Banner>
      )}
      {bom?.status === "Draft" && !bom.revisionNote && isGM && (
        <p className="bom-status-line">
          Check every section against the signed and sealed copy, correct anything that differs, then approve.
          The project can be activated once the BOM is approved.
        </p>
      )}

      {importReport && (
        <Banner
          tone={importReport.skippedRows.length ? "warning" : "success"}
          title={`Imported ${bom?.totals.itemCount ?? 0} items in ${bom?.totals.sectionCount ?? 0} sections from ${importReport.fileName}.`}
        >
          {importReport.skippedRows.length > 0 && (
            <>
              These rows were not imported. Add them by hand if they belong in the BOM:
              <ul className="bom-list">
                {importReport.skippedRows.map((r) => (
                  <li key={r.row}>
                    Row {r.row}{r.description ? ` (${r.description})` : ""}: {r.reason}
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
          <h2>No Bill of Materials yet</h2>
          {isGM && !projectClosed ? (
            <>
              <p>
                Import the signed BOM in the company's Excel format. Sections, items and labor are read from the
                file; the header (owner, address) and the signatures are not stored.
              </p>
              <div className="bom-empty-actions">
                <Button onClick={chooseFile} disabled={Boolean(busy)}>
                  {busy === "import" ? "Importing…" : "Import from Excel (.xlsx)"}
                </Button>
                <Button variant="ghost" onClick={startManual}>Enter it by hand</Button>
              </div>
            </>
          ) : (
            <p>The General Manager hasn't added this project's BOM yet.</p>
          )}
        </div>
      )}

      {draft && totals && (
        <>
          <section className="bom-totals" aria-label="BOM totals">
            <div className="bom-total">
              <span className="bom-total-label">Materials</span>
              <span className="bom-total-value">{PESO.format(totals.materials)}</span>
              <span className="bom-total-note">
                {totals.items} {totals.items === 1 ? "item" : "items"} in {draft.length} {draft.length === 1 ? "section" : "sections"}
              </span>
            </div>
            <div className="bom-total">
              <span className="bom-total-label">Labor</span>
              <span className="bom-total-value">{PESO.format(totals.labor)}</span>
              <span className="bom-total-note">Reference only; not purchased</span>
            </div>
            <div className="bom-total bom-total-main">
              <span className="bom-total-label">BOM total</span>
              <span className="bom-total-value">{PESO.format(totals.total)}</span>
              <span className={"bom-total-note" + (differs(totals.total, statedTotal) ? " bom-mismatch" : "")}>
                {statedTotal === null
                  ? bom?.sourceFileName ? "No total in the file" : "Entered by hand"
                  : differs(totals.total, statedTotal)
                    ? `File says ${PESO.format(statedTotal)}`
                    : "Matches the file"}
              </span>
            </div>
            <div className="bom-total">
              <span className="bom-total-label">Project budget</span>
              <span className="bom-total-value">{PESO.format(Number(project?.budget ?? data.projectBudget ?? 0))}</span>
              <span className="bom-total-note">
                {bom?.status === "Approved" ? "Set from the BOM total" : "Becomes the BOM total on approval"}
              </span>
            </div>
          </section>

          {!dirty && (warnings.length > 0 || infos.length > 0) && (
            <section className="bom-checks" aria-labelledby="bom-checks-title">
              <h2 id="bom-checks-title" className="bom-checks-title">
                {!warnings.length
                  ? "Notes"
                  : bom.status === "Approved"
                    ? `Flagged during review (${warnings.length})`
                    : `Check before approving (${warnings.length})`}
              </h2>
              <ul className="bom-list">
                {warnings.map((w, i) => <li key={`w${i}`} className="bom-check-warning">{w.message}</li>)}
                {infos.map((w, i) => <li key={`i${i}`} className="bom-check-info">{w.message}</li>)}
              </ul>
            </section>
          )}
          {dirty && (
            <p className="bom-status-line">Checks against the file are updated when you save.</p>
          )}

          {draft.map((s, si) => {
            const c = sectionCalc(s);
            const matMismatch = differs(c.materials, s.statedMaterialTotal);
            const laborMismatch = s.laborMode !== "included" && differs(c.labor, s.statedLaborAmount);
            const p = `sections[${si}]`;
            return (
              <section key={s.key} className="bom-section" aria-label={s.name || `Section ${si + 1}`}>
                <div className="bom-section-head">
                  {editing ? (
                    <div className="bom-section-names">
                      <input
                        className={"bom-input bom-input-name" + (fieldErr(`${p}.name`) ? " bom-input-error" : "")}
                        value={s.name}
                        placeholder="Section name, e.g. STRUCTURAL"
                        aria-label="Section name"
                        onChange={(e) => setSection(si, { name: e.target.value })}
                      />
                      <input
                        className="bom-input bom-input-sub"
                        value={s.subheading}
                        placeholder="Sub-heading (optional)"
                        aria-label="Sub-heading"
                        onChange={(e) => setSection(si, { subheading: e.target.value })}
                      />
                    </div>
                  ) : (
                    <div>
                      <h2 className="bom-section-title">{s.name}</h2>
                      {s.subheading && <p className="bom-section-sub">{s.subheading}</p>}
                    </div>
                  )}
                  <div className="bom-section-side">
                    <span className="bom-section-total">{PESO.format(c.total)}</span>
                    {editing && (
                      <span className="bom-section-tools">
                        <button type="button" className="bom-icon-btn" onClick={() => moveSection(si, -1)} disabled={si === 0} aria-label="Move section up">↑</button>
                        <button type="button" className="bom-icon-btn" onClick={() => moveSection(si, 1)} disabled={si === draft.length - 1} aria-label="Move section down">↓</button>
                        <button
                          type="button"
                          className="bom-text-btn bom-text-danger"
                          onClick={() => removeSection(si)}
                          disabled={s.items.some((it) => it.inUse)}
                        >
                          Remove section
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
                        <th>Description</th>
                        <th className="num bom-col-qty">Qty</th>
                        <th className="bom-col-unit">Unit</th>
                        <th className="num bom-col-cost">Unit cost</th>
                        <th className="num bom-col-amount">Cost</th>
                        {editing && <th className="bom-col-act"><span className="visually-hidden">Remove</span></th>}
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
                                  <input className={"bom-input" + (fieldErr(`${ip}.description`) ? " bom-input-error" : "")} value={it.description} aria-label="Description"
                                    onChange={(e) => setItem(si, ii, { description: e.target.value })} />
                                </td>
                                <td className="num">
                                  <input className={"bom-input num" + (fieldErr(`${ip}.quantity`) ? " bom-input-error" : "")} type="number" min="0" step="any" inputMode="decimal" value={it.quantity} aria-label="Quantity"
                                    onChange={(e) => setItem(si, ii, { quantity: e.target.value })} />
                                </td>
                                <td>
                                  <input className={"bom-input" + (fieldErr(`${ip}.unit`) ? " bom-input-error" : "")} value={it.unit} aria-label="Unit" disabled={it.inUse}
                                    title={it.inUse ? "Used by a material request; the unit can't change" : undefined}
                                    onChange={(e) => setItem(si, ii, { unit: e.target.value })} />
                                </td>
                                <td className="num">
                                  <input className={"bom-input num" + (fieldErr(`${ip}.unitCost`) ? " bom-input-error" : "")} type="number" min="0" step="any" inputMode="decimal" value={it.unitCost} aria-label="Unit cost"
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
                                  aria-label={`Remove ${it.description || "item"}`} title={it.inUse ? "Used by a material request" : "Remove item"}>
                                  ×
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      {s.items.length === 0 && (
                        <tr><td colSpan={editing ? 7 : 6} className="bom-empty-row">No items in this section.</td></tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={5}>
                          {s.laborMode === "included" ? "Labor and material cost" : "Material cost"}
                          {matMismatch && <span className="bom-mismatch"> · file says {PESO.format(s.statedMaterialTotal)}</span>}
                        </td>
                        <td className="num">{PESO.format(c.materials)}</td>
                        {editing && <td />}
                      </tr>
                      <tr>
                        <td colSpan={5}>
                          <span className="bom-labor">
                            Labor
                            {editing ? (
                              <>
                                <select className="bom-input bom-labor-mode" value={s.laborMode} aria-label="How labor is computed"
                                  onChange={(e) => setSection(si, { laborMode: e.target.value })}>
                                  {LABOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                                {s.laborMode === "rate" && (
                                  <span className="bom-labor-input">
                                    <input className={"bom-input num" + (fieldErr(`${p}.laborRate`) ? " bom-input-error" : "")} type="number" min="0" step="any" value={s.laborRatePct} aria-label="Labor percent"
                                      onChange={(e) => setSection(si, { laborRatePct: e.target.value })} />%
                                  </span>
                                )}
                                {s.laborMode === "amount" && (
                                  <span className="bom-labor-input">
                                    ₱<input className={"bom-input num" + (fieldErr(`${p}.laborAmount`) ? " bom-input-error" : "")} type="number" min="0" step="any" value={s.laborAmount} aria-label="Labor amount"
                                      onChange={(e) => setSection(si, { laborAmount: e.target.value })} />
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="bom-labor-desc">
                                {s.laborMode === "rate" && `${round2(Number(s.laborRatePct))}% of materials`}
                                {s.laborMode === "amount" && "fixed amount"}
                                {s.laborMode === "included" && "included in the prices"}
                                {s.laborMode === "none" && "none"}
                              </span>
                            )}
                          </span>
                          {laborMismatch && <span className="bom-mismatch"> · file says {PESO.format(s.statedLaborAmount)}</span>}
                        </td>
                        <td className="num">{s.laborMode === "included" ? "—" : PESO.format(c.labor)}</td>
                        {editing && <td />}
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {editing && (
                  <button type="button" className="bom-text-btn" onClick={() => addItem(si)}>+ Add item</button>
                )}
              </section>
            );
          })}

          {editing && (
            <div className="bom-bottom-actions">
              <Button variant="secondary" onClick={addSection}>Add section</Button>
              {bom && data.projectStatus === "Draft" && !dirty && (
                <button type="button" className="bom-text-btn bom-text-danger" onClick={() => openDialog("delete")}>
                  Remove this BOM
                </button>
              )}
            </div>
          )}
        </>
      )}

      {editing && dirty && (
        <div className="bom-savebar" role="region" aria-label="Unsaved changes">
          <span>Unsaved changes</span>
          <div className="bom-savebar-actions">
            <Button variant="secondary" onClick={discard} disabled={Boolean(busy)}>Discard</Button>
            <Button onClick={handleSave} disabled={Boolean(busy)}>{busy === "save" ? "Saving…" : "Save changes"}</Button>
          </div>
        </div>
      )}

      {dialog && (
        <div className="modal-overlay" role="presentation" onClick={() => !busy && setDialog(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="bom-dialog-title" onClick={(e) => e.stopPropagation()}>
            {dialog === "approve" && (
              <>
                <h2 id="bom-dialog-title" className="modal-title">Approve this BOM?</h2>
                <p className="modal-body">
                  It will be locked and used as the basis for every material request. The project budget becomes the
                  BOM total, <strong>{PESO.format(bom.totals.total)}</strong>
                  {Number(data.projectBudget) !== bom.totals.total ? ` (now ${PESO.format(Number(data.projectBudget))})` : ""}.
                </p>
                {warnings.length > 0 && (
                  <>
                    <ul className="bom-list bom-dialog-list">
                      {warnings.map((w, i) => <li key={i}>{w.message}</li>)}
                    </ul>
                    <label className="bom-confirm">
                      <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} />
                      I checked these against the signed and sealed BOM.
                    </label>
                  </>
                )}
              </>
            )}
            {dialog === "reopen" && (
              <>
                <h2 id="bom-dialog-title" className="modal-title">Reopen the BOM for revision?</h2>
                <p className="modal-body">
                  It goes back to Draft so you can correct it. The Project Manager is notified. Approve it again when done.
                </p>
                <Field label="Reason" required as="textarea" placeholder="e.g. Owner approved an added gate"
                  value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
              </>
            )}
            {dialog === "delete" && (
              <>
                <h2 id="bom-dialog-title" className="modal-title">Remove this BOM?</h2>
                <p className="modal-body">All its sections and items are deleted. You can import the correct file afterwards.</p>
              </>
            )}
            {dialog === "replace" && (
              <>
                <h2 id="bom-dialog-title" className="modal-title">Replace the BOM with a new file?</h2>
                <p className="modal-body">
                  Every section and item, including your edits, is replaced by what is in the file you choose.
                </p>
              </>
            )}
            {actionError && <Banner tone="error" title={actionError} />}
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setDialog(null)} disabled={Boolean(busy)}>Back</Button>
              {dialog === "approve" && (
                <Button onClick={handleApprove} disabled={Boolean(busy) || (warnings.length > 0 && !confirmChecked)}>
                  {busy === "approve" ? "Approving…" : "Approve"}
                </Button>
              )}
              {dialog === "reopen" && (
                <Button onClick={handleReopen} disabled={Boolean(busy) || !reopenReason.trim()}>
                  {busy === "reopen" ? "Reopening…" : "Reopen"}
                </Button>
              )}
              {dialog === "delete" && (
                <Button variant="danger" onClick={handleDelete} disabled={Boolean(busy)}>
                  {busy === "delete" ? "Removing…" : "Remove BOM"}
                </Button>
              )}
              {dialog === "replace" && (
                <Button
                  onClick={() => {
                    setDialog(null);
                    fileInput.current?.click();
                  }}
                >
                  Choose file
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
