import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  listManagedTickets,
  listPurchasers,
  listApprovedVendors,
  acknowledgeTicket,
  resolveTicket,
  updateTicket,
  rejectTicket,
} from "../../api/ticketsApi";
import { extractErrorMessage } from "../../api/client";
import { Badge } from "../../components/ui/Badge";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { SearchableSelect } from "../../components/ui/SearchableSelect";
import { TicketForm } from "../../components/tickets/TicketForm";
import { useLocale } from "../../i18n/LocaleProvider";
import "./TicketQueuePage.css";

const DATETIME_OPTIONS = { dateStyle: "medium", timeStyle: "short" };
const DAY_OPTIONS = { dateStyle: "medium" };
const TIME_OPTIONS = { hour: "numeric", minute: "2-digit" };
const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });
const QTY = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 });

// The label shown for each type comes from the catalog: tv("tickettype", type).
const TYPE_META = {
  "Material Request": { key: "material" },
  "Work Item": { key: "work" },
  Report: { key: "report" },
};

// The three status views the PM moves a ticket through.
const TABS = [
  { key: "Pending", labelKey: "tq.tab_pending" },
  { key: "Acknowledged", labelKey: "tq.tab_ack" },
  { key: "History", labelKey: "tq.tab_history" },
];

const TYPE_FILTERS = ["All", "Material Request", "Work Item", "Report"];

const UNIT_OPTIONS = [
  "pcs", "set", "lot", "unit",
  "kg", "g", "L", "mL",
  "m", "cm", "mm", "sq.m", "cu.m",
  "bag", "box", "roll", "sheet", "pair", "bundle", "gal", "can", "truckload",
];

// Quick-pick reasons for rejecting — keeps the reason the SM sees consistent
// and readable. The PM can still add a note (or write a note alone).
const REJECT_REASONS = ["tq.reason_qty", "tq.reason_dup", "tq.reason_wrong", "tq.reason_phase"];

// A batch submitted from mobile is several tickets created in one transaction,
// so every ticket in it shares an exact createdAt. Group by submitter+createdAt.
function groupKey(t) {
  return `${t.submittedby}|${t.createdat}`;
}

export function TicketQueuePage() {
  // `t` is used as a loop variable for tickets throughout this file, so the translate function is `tr`.
  const { t: tr, tv } = useLocale();
  const [activeTab, setActiveTab] = useState("Pending");
  const [tickets, setTickets] = useState([]);
  const [purchasers, setPurchasers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submittingId, setSubmittingId] = useState(null);
  const [activeType, setActiveType] = useState("All");
  const [projectFilter, setProjectFilter] = useState("All");
  const [createOpen, setCreateOpen] = useState(false);

  // Per-ticket assign state (Needs action tab).
  const [assignments, setAssignments] = useState({});
  const [approvedBudgets, setApprovedBudgets] = useState({});
  // Needed-by dates the PM changed, by ticket id. A ticket not in here keeps
  // the date the Site Manager gave (or none).
  const [neededByDates, setNeededByDates] = useState({});

  // Edit modal.
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");

  // Reject modal: { ticket, chips:Set, note }.
  const [reject, setReject] = useState(null);
  const [rejectBusy, setRejectBusy] = useState(false);
  const [rejectError, setRejectError] = useState("");

  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("focus");
  const [highlightId, setHighlightId] = useState(null);

  async function loadTab(tab, { keepError = false } = {}) {
    setLoading(true);
    if (!keepError) setError("");
    try {
      const [rows, availablePurchasers, approvedVendors] = await Promise.all([
        listManagedTickets(tab),
        listPurchasers().catch(() => []),
        listApprovedVendors().catch(() => []),
      ]);
      setTickets(rows);
      setPurchasers(availablePurchasers);
      setVendors(approvedVendors);
      // Seed the approved-budget inputs: prefer the BOM figure (qty × unit
      // cost) for on-BOM Material Requests, else the SM's requested budget.
      // Purchaser select starts empty — no silent default.
      setApprovedBudgets((current) => {
        const next = { ...current };
        for (const t of rows) {
          if (next[t.ticketid] === undefined) {
            if (t.tickettype === "Material Request") {
              const bom = t.bomUnitCost != null && t.quantity != null
                ? Number(t.bomUnitCost) * Number(t.quantity)
                : null;
              next[t.ticketid] = bom != null
                ? String(Math.round(bom * 100) / 100)
                : (t.requestedbudget == null ? "" : String(t.requestedbudget));
            }
          }
        }
        return next;
      });
    } catch (err) {
      setError(extractErrorMessage(err, tr("errors.load_tickets_q")));
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTab(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Deep link: ?focus=<id>. If the ticket isn't in the current tab, switch to
  // the tab that holds it, then scroll + highlight once it's loaded.
  useEffect(() => {
    if (!focusId || loading) return undefined;
    const here = tickets.some((t) => String(t.ticketid) === String(focusId));
    if (!here) {
      // Try to find it: ask each other tab in turn until one has it.
      let cancelled = false;
      (async () => {
        for (const tab of TABS.map((t) => t.key)) {
          if (tab === activeTab) continue;
          // eslint-disable-next-line no-await-in-loop
          const rows = await listManagedTickets(tab).catch(() => []);
          if (rows.some((t) => String(t.ticketid) === String(focusId))) {
            if (!cancelled) setActiveTab(tab);
            return;
          }
        }
      })();
      return () => { cancelled = true; };
    }
    setActiveType("All");
    setProjectFilter("All");
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`ticket-${focusId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    setHighlightId(focusId);
    const timer = setTimeout(() => setHighlightId(null), 2500);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, [focusId, loading, tickets, activeTab]);

  function removeFromView(ticketId) {
    setTickets((cur) => cur.filter((t) => t.ticketid !== ticketId));
  }

  async function handleAcknowledge(ticket) {
    const assignedTo = assignments[ticket.ticketid];
    if (!assignedTo) {
      setError(tr("tq.err_choose_purchaser"));
      return;
    }
    const budgetText = approvedBudgets[ticket.ticketid] ?? "";
    const approvedBudget = ticket.tickettype === "Material Request" ? Number(budgetText) : undefined;
    if (ticket.tickettype === "Material Request" && (budgetText === "" || !Number.isFinite(approvedBudget) || approvedBudget < 0)) {
      setError(tr("tq.err_budget"));
      return;
    }
    setSubmittingId(ticket.ticketid);
    setError("");
    try {
      await acknowledgeTicket(ticket.ticketid, assignedTo, approvedBudget, neededByDates[ticket.ticketid]);
      removeFromView(ticket.ticketid);
    } catch (err) {
      setError(extractErrorMessage(err, tr("errors.ack_failed")));
    } finally {
      setSubmittingId(null);
    }
  }

  // "Assign all" for a batch group: acknowledge each MR/Work Item in turn,
  // using each card's own purchaser + budget (so a per-ticket override the PM
  // set still applies). Reports in the group are left for the single Resolve.
  async function handleAssignAll(group) {
    const actionable = group.filter((t) => t.tickettype !== "Report");
    const missing = actionable.filter((t) => !assignments[t.ticketid]);
    if (missing.length > 0) {
      setError(tr("tq.err_batch_purchaser"));
      return;
    }
    setError("");
    setSubmittingId(`batch:${groupKey(group[0])}`);
    const failures = [];
    for (const t of actionable) {
      const budgetText = approvedBudgets[t.ticketid] ?? "";
      const approvedBudget = t.tickettype === "Material Request" ? Number(budgetText) : undefined;
      if (t.tickettype === "Material Request" && (budgetText === "" || !Number.isFinite(approvedBudget) || approvedBudget < 0)) {
        failures.push(tr("tq.batch_budget_fail", { subject: t.subject }));
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await acknowledgeTicket(t.ticketid, assignments[t.ticketid], approvedBudget, neededByDates[t.ticketid]);
        removeFromView(t.ticketid);
      } catch (err) {
        failures.push(`${t.subject}: ${extractErrorMessage(err, tr("tq.failed"))}`);
      }
    }
    setSubmittingId(null);
    if (failures.length > 0) setError(tr("tq.batch_failures", { list: failures.join("; ") }));
  }

  async function handleResolve(ticket) {
    setSubmittingId(ticket.ticketid);
    setError("");
    try {
      await resolveTicket(ticket.ticketid);
      removeFromView(ticket.ticketid);
    } catch (err) {
      setError(extractErrorMessage(err, tr("errors.resolve_failed")));
    } finally {
      setSubmittingId(null);
    }
  }

  function openReject(ticket) {
    setRejectError("");
    setReject({ ticket, chips: new Set(), note: "" });
  }
  function toggleRejectChip(reasonKey) {
    setReject((r) => {
      const chips = new Set(r.chips);
      if (chips.has(reasonKey)) chips.delete(reasonKey);
      else chips.add(reasonKey);
      return { ...r, chips };
    });
  }
  function composedReason(r) {
    const parts = [...r.chips].map((key) => tr(key));
    const note = r.note.trim();
    if (note) parts.push(note);
    return parts.join(" — ");
  }
  async function handleRejectSubmit() {
    if (!reject) return;
    const reason = composedReason(reject);
    if (!reason) {
      setRejectError(tr("tq.err_reject_reason"));
      return;
    }
    setRejectBusy(true);
    setRejectError("");
    try {
      await rejectTicket(reject.ticket.ticketid, reason);
      removeFromView(reject.ticket.ticketid);
      setReject(null);
    } catch (err) {
      setRejectError(extractErrorMessage(err, tr("errors.reject_failed")));
    } finally {
      setRejectBusy(false);
    }
  }

  function handleCreated() {
    // A PM-created ticket is born Acknowledged — refresh whichever tab is open.
    loadTab(activeTab);
  }

  function openEdit(ticket) {
    setEditError("");
    setEditForm({
      subject: ticket.subject || "",
      description: ticket.description || "",
      quantity: ticket.quantity == null ? "" : String(ticket.quantity),
      unit: ticket.unit || "",
      materialType: ticket.materialtype || "",
      vendorName: ticket.vendorname || "",
      requestedBudget: ticket.requestedbudget == null ? "" : String(ticket.requestedbudget),
      notInBomReason: ticket.notinbomreason || "",
    });
    setEditing({ ticket });
  }
  function closeEdit() {
    if (editBusy) return;
    setEditing(null);
    setEditForm(null);
    setEditError("");
  }
  async function handleEditSave() {
    if (!editing || !editForm || editBusy) return;
    const t = editing.ticket;
    const isMR = t.tickettype === "Material Request";
    const isWork = t.tickettype === "Work Item";
    const onBom = t.bomitemid != null;

    if (!editForm.subject.trim()) { setEditError(tr("tf.err_subject")); return; }
    const payload = {
      subject: editForm.subject.trim(),
      description: editForm.description.trim() || undefined,
    };
    if (isMR || isWork) {
      const q = Number(editForm.quantity);
      if (!Number.isFinite(q) || q <= 0) { setEditError(tr("tf.err_quantity")); return; }
      payload.quantity = q;
      payload.vendorName = editForm.vendorName;
    }
    if (isMR) {
      const b = Number(editForm.requestedBudget);
      if (!Number.isFinite(b) || b < 0) { setEditError(tr("tf.err_requested_budget")); return; }
      payload.requestedBudget = b;
    }
    if ((isMR && !onBom) || isWork) {
      if (!editForm.materialType.trim()) { setEditError(tr("tq.err_material")); return; }
      if (!editForm.unit.trim()) { setEditError(tr("tq.err_unit")); return; }
      payload.materialType = editForm.materialType.trim();
      payload.unit = editForm.unit;
    }
    if (isMR && !onBom) {
      if (!editForm.notInBomReason.trim()) { setEditError(tr("tf.err_reason")); return; }
      payload.notInBomReason = editForm.notInBomReason.trim();
    }

    setEditBusy(true);
    setEditError("");
    try {
      const updated = await updateTicket(t.ticketid, payload);
      setTickets((cur) => cur.map((item) => (item.ticketid === t.ticketid ? { ...item, ...updated } : item)));
      setApprovedBudgets((cur) => ({ ...cur, [t.ticketid]: updated.requestedbudget == null ? (cur[t.ticketid] ?? "") : String(updated.requestedbudget) }));
      setEditing(null);
      setEditForm(null);
    } catch (err) {
      setEditError(extractErrorMessage(err, tr("errors.save_changes")));
    } finally {
      setEditBusy(false);
    }
  }

  // Projects present in the loaded rows, for the project filter (only shown
  // when the PM manages more than one project in this view).
  const projects = useMemo(() => {
    const map = new Map();
    for (const t of tickets) {
      const name = t.projectname || t.projectName;
      if (name && !map.has(t.projectid)) map.set(t.projectid, name);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [tickets]);

  const counts = useMemo(() => {
    const byType = { All: 0 };
    for (const t of tickets) {
      if (projectFilter !== "All" && t.projectid !== projectFilter) continue;
      byType.All += 1;
      byType[t.tickettype] = (byType[t.tickettype] || 0) + 1;
    }
    return byType;
  }, [tickets, projectFilter]);

  const visibleTickets = useMemo(() => {
    return tickets.filter(
      (t) =>
        (activeType === "All" || t.tickettype === activeType) &&
        (projectFilter === "All" || t.projectid === projectFilter)
    );
  }, [tickets, activeType, projectFilter]);

  // Group the visible tickets. On the Needs-action tab a batch (≥2 sharing
  // submitter+createdAt) becomes one block; everywhere else cards stand alone.
  const blocks = useMemo(() => {
    if (activeTab !== "Pending") {
      return visibleTickets.map((t) => ({ kind: "single", ticket: t }));
    }
    const out = [];
    const used = new Set();
    for (const t of visibleTickets) {
      if (used.has(t.ticketid)) continue;
      const mates = visibleTickets.filter((o) => groupKey(o) === groupKey(t));
      if (mates.length >= 2) {
        mates.forEach((m) => used.add(m.ticketid));
        out.push({ kind: "batch", key: groupKey(t), tickets: mates });
      } else {
        used.add(t.ticketid);
        out.push({ kind: "single", ticket: t });
      }
    }
    return out;
  }, [visibleTickets, activeTab]);

  return (
    <div className="ticket-queue">
      <div className="ticket-queue-header">
        <div>
          <h1>{tr("nav.tickets")}</h1>
          <p className="ticket-queue-subtitle">{tr("tq.subtitle")}</p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>{tr("nav.new_ticket")}</Button>
      </div>

      <div className="ticket-tabs" role="tablist" aria-label={tr("tq.status_aria")}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={"ticket-tab" + (activeTab === tab.key ? " ticket-tab-active" : "")}
            onClick={() => { setActiveTab(tab.key); setActiveType("All"); }}
          >
            {tr(tab.labelKey)}
          </button>
        ))}
      </div>

      {error && <Banner tone="error" title={error} />}

      {!loading && tickets.length > 0 && (
        <div className="ticket-queue-controls">
          <div className="ticket-queue-filters" role="tablist" aria-label={tr("tq.filter_type")}>
            {TYPE_FILTERS.map((type) => {
              const count = type === "All" ? counts.All : counts[type] || 0;
              if (type !== "All" && count === 0) return null;
              const meta = TYPE_META[type];
              return (
                <button
                  key={type}
                  type="button"
                  role="tab"
                  aria-selected={activeType === type}
                  className={
                    "ticket-filter" +
                    (activeType === type ? " ticket-filter-active" : "") +
                    (meta ? ` ticket-filter-${meta.key}` : "")
                  }
                  onClick={() => setActiveType(type)}
                >
                  {type === "All" ? tr("common.all") : tv("tickettype", type)}
                  <span className="ticket-filter-count">{count}</span>
                </button>
              );
            })}
          </div>

          {projects.length > 1 && (
            <div className="ticket-project-filter">
              <span>{tr("nav.project")}</span>
              <SearchableSelect
                inline
                value={projectFilter}
                onChange={setProjectFilter}
                options={[
                  { value: "All", label: tr("tq.all_projects"), pinned: true },
                  ...projects.map((p) => ({ value: p.id, label: p.name })),
                ]}
                placeholder={tr("tq.all_projects")}
                searchPlaceholder={tr("ss.search_ph")}
                noMatchText={tr("ss.no_match", { query: "{query}" })}
              />
            </div>
          )}
        </div>
      )}

      {loading && <p className="ticket-queue-loading">{tr("tq.loading")}</p>}

      {!loading && tickets.length === 0 && (
        <div className="ticket-queue-empty">
          <h2>{activeTab === "Pending" ? tr("tq.empty_pending") : activeTab === "Acknowledged" ? tr("tq.empty_ack") : tr("tq.empty_hist")}</h2>
          <p>
            {activeTab === "Pending" && tr("tq.empty_pending_body")}
            {activeTab === "Acknowledged" && tr("tq.empty_ack_body")}
            {activeTab === "History" && tr("tq.empty_hist_body")}
          </p>
        </div>
      )}

      {!loading && tickets.length > 0 && visibleTickets.length === 0 && (
        <div className="ticket-queue-empty ticket-queue-empty-filtered">
          <p>{tr("tq.no_match")}</p>
        </div>
      )}

      {!loading && blocks.length > 0 && (
        <div className="ticket-queue-list">
          {blocks.map((block) =>
            block.kind === "batch" ? (
              <BatchBlock
                key={block.key}
                tickets={block.tickets}
                purchasers={purchasers}
                assignments={assignments}
                setAssignments={setAssignments}
                approvedBudgets={approvedBudgets}
                setApprovedBudgets={setApprovedBudgets}
                neededByDates={neededByDates}
                setNeededByDates={setNeededByDates}
                submittingId={submittingId}
                highlightId={highlightId}
                activeTab={activeTab}
                onAcknowledge={handleAcknowledge}
                onResolve={handleResolve}
                onReject={openReject}
                onEdit={openEdit}
                onAssignAll={handleAssignAll}
              />
            ) : (
              <TicketCard
                key={block.ticket.ticketid}
                ticket={block.ticket}
                purchasers={purchasers}
                assignments={assignments}
                setAssignments={setAssignments}
                approvedBudgets={approvedBudgets}
                setApprovedBudgets={setApprovedBudgets}
                neededByDates={neededByDates}
                setNeededByDates={setNeededByDates}
                submittingId={submittingId}
                highlightId={highlightId}
                activeTab={activeTab}
                onAcknowledge={handleAcknowledge}
                onResolve={handleResolve}
                onReject={openReject}
                onEdit={openEdit}
              />
            )
          )}
        </div>
      )}

      {reject && (
        <RejectModal
          state={reject}
          busy={rejectBusy}
          error={rejectError}
          onToggleChip={toggleRejectChip}
          onNote={(note) => setReject((r) => ({ ...r, note }))}
          onCancel={() => !rejectBusy && setReject(null)}
          onSubmit={handleRejectSubmit}
        />
      )}

      {editing && editForm && (
        <EditModal
          editing={editing}
          editForm={editForm}
          setEditForm={setEditForm}
          editBusy={editBusy}
          editError={editError}
          vendors={vendors}
          onCancel={closeEdit}
          onSave={handleEditSave}
        />
      )}

      {createOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="ticket-create-title">
          <div className="modal modal-ticket">
            <div className="modal-head">
              <h2 id="ticket-create-title" className="modal-title">{tr("nav.new_ticket")}</h2>
              <button type="button" className="modal-close" onClick={() => setCreateOpen(false)} aria-label={tr("pd.close")}>×</button>
            </div>
            <TicketForm onSuccess={handleCreated} onClose={() => setCreateOpen(false)} onCancel={() => setCreateOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---- BOM context strip (on-BOM Material Requests) ----
function BomStrip({ ticket }) {
  const { t: tr } = useLocale();
  if (ticket.tickettype !== "Material Request" || ticket.bomitemid == null || ticket.bomUnitCost == null) {
    if (ticket.tickettype === "Material Request" && ticket.notinbom) {
      return (
        <div className="bom-strip bom-strip-off">
          <span className="bom-strip-tag">{tr("tq.not_in_bom")}</span>
          <span className="bom-strip-reason">{ticket.notinbomreason || tr("tq.no_reason")}</span>
        </div>
      );
    }
    return null;
  }
  const bomQty = Number(ticket.bomQuantity);
  const unitCost = Number(ticket.bomUnitCost);
  const already = Number(ticket.bomAlreadyRequested || 0);
  const thisQty = Number(ticket.quantity || 0);
  const projected = already + thisQty;
  const over = projected - bomQty;
  const unit = ticket.bomUnit || ticket.unit || "";
  return (
    <div className={"bom-strip" + (over > 0 ? " bom-strip-over" : "")}>
      <span className="bom-strip-tag">{tr("tq.bom_tag")}</span>
      <span className="bom-strip-fact">{tr("tq.bom_fact", { qty: QTY.format(bomQty), unit, price: PESO.format(unitCost) })}</span>
      <span className="bom-strip-sep">·</span>
      <span className="bom-strip-fact">{tr("tq.already", { qty: QTY.format(already) })}</span>
      <span className="bom-strip-sep">·</span>
      <span className="bom-strip-fact">{tr("tq.this_request", { qty: QTY.format(thisQty) })}</span>
      <span className="bom-strip-arrow">→</span>
      {over > 0
        ? <span className="bom-strip-flag">{tr("tq.over_bom", { qty: QTY.format(over), unit })}</span>
        : <span className="bom-strip-ok">{tr("tq.left", { qty: QTY.format(bomQty - projected), unit })}</span>}
    </div>
  );
}

// "YYYY-MM-DD" for a <input type="date">, from the API's ISO date (read in local time).
function toInputDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayInputValue() {
  return toInputDate(new Date().toISOString());
}

// ---- A single ticket card ----
function TicketCard(props) {
  const {
    ticket, purchasers, assignments, setAssignments, approvedBudgets, setApprovedBudgets,
    neededByDates, setNeededByDates,
    submittingId, highlightId, activeTab, onAcknowledge, onResolve, onReject, onEdit, inBatch,
  } = props;
  const { t: tr, tv, formatDate } = useLocale();
  const meta = TYPE_META[ticket.tickettype] || { key: "work" };
  const isReport = ticket.tickettype === "Report";
  const busy = submittingId === ticket.ticketid || (typeof submittingId === "string" && submittingId.startsWith("batch:"));
  const focus = String(ticket.ticketid) === String(highlightId);

  return (
    <article
      id={`ticket-${ticket.ticketid}`}
      className={`ticket-card ticket-card-${meta.key}` + (focus ? " ticket-card-focus" : "") + (inBatch ? " ticket-card-in-batch" : "")}
    >
      <div className="ticket-card-head">
        <div className="ticket-card-head-main">
          <div className="ticket-card-tags">
            <span className={`ticket-type-pill ticket-type-pill-${meta.key}`}>{tv("tickettype", ticket.tickettype)}</span>
            <Badge status={ticket.status} />
            {ticket.resubmittedfromid && <span className="ticket-resubmit-pill">{tr("tq.resubmission")}</span>}
            {ticket.wasResubmitted && <span className="ticket-resubmit-pill ticket-resubmit-pill-done">{tr("tq.resubmitted")}</span>}
          </div>
          <h2 className="ticket-card-subject">{ticket.subject}</h2>
          <p className="ticket-card-context">
            {tr("tq.submitted_by", { project: ticket.projectname || ticket.projectName, name: ticket.submittedbyname || "Site Manager" })}
          </p>
        </div>
        <div className="ticket-card-head-side">
          <time className="ticket-card-date" dateTime={ticket.createdat}>{formatDate(ticket.createdat, DATETIME_OPTIONS)}</time>
          {activeTab === "Pending" && (
            <button type="button" className="ticket-card-edit" onClick={() => onEdit(ticket)} disabled={busy}>{tr("tq.edit")}</button>
          )}
        </div>
      </div>

      {ticket.resubmittedfromid && ticket.resubmitOfReason && (
        <p className="ticket-resubmit-note">
          {tr("tq.prev_rejected", { reason: ticket.resubmitOfReason })}
        </p>
      )}

      {ticket.description && <p className="ticket-card-description">{ticket.description}</p>}

      {!isReport && (ticket.materialtype || ticket.quantity || ticket.vendorname) && (
        <dl className="ticket-card-facts">
          <div><dt>{tr("tq.material")}</dt><dd>{ticket.materialtype || "—"}</dd></div>
          <div><dt>{tr("bom.aria_quantity")}</dt><dd>{ticket.quantity != null ? `${QTY.format(ticket.quantity)}${ticket.unit ? ` ${ticket.unit}` : ""}` : "—"}</dd></div>
          <div><dt>{tr("tq.pref_vendor")}</dt><dd>{ticket.vendorname || "—"}</dd></div>
          <div><dt>{tr("tq.needed_by")}</dt><dd>{ticket.neededby ? formatDate(ticket.neededby, DAY_OPTIONS) : tr("tq.not_given")}</dd></div>
          {ticket.tickettype === "Material Request" && (
            <div><dt>{tr("tq.sm_requested")}</dt><dd>{ticket.requestedbudget == null ? tr("tq.not_provided") : PESO.format(Number(ticket.requestedbudget))}</dd></div>
          )}
        </dl>
      )}

      <BomStrip ticket={ticket} />

      {/* Action area depends on the tab. */}
      {activeTab === "Pending" && (
        isReport ? (
          <div className="ticket-card-foot ticket-card-foot-report">
            <p className="ticket-card-context">{tr("tq.report_note")}</p>
            <div className="ticket-card-actions">
              <Button type="button" disabled={busy} onClick={() => onResolve(ticket)}>
                {busy ? tr("tq.resolving") : tr("tq.resolve_report")}
              </Button>
              <button type="button" className="ticket-reject-link" onClick={() => onReject(ticket)} disabled={busy}>{tr("expenses.reject")}</button>
            </div>
          </div>
        ) : (
          <div className="ticket-card-foot">
            <div className="ticket-card-assign">
              <Field
                label={tr("tq.assign_purchaser")}
                as="select"
                value={assignments[ticket.ticketid] || ""}
                disabled={busy || purchasers.length === 0}
                onChange={(e) => setAssignments((cur) => ({ ...cur, [ticket.ticketid]: e.target.value }))}
              >
                <option value="">{tr("tf.select_purchaser")}</option>
                {purchasers.map((p) => (
                  <option key={p.userid} value={p.userid}>{p.name} ({p.email})</option>
                ))}
              </Field>
              <Field
                label={tr("tq.needed_by_opt")}
                type="date"
                min={todayInputValue()}
                value={neededByDates[ticket.ticketid] ?? toInputDate(ticket.neededby)}
                disabled={busy}
                onChange={(e) => setNeededByDates((cur) => ({ ...cur, [ticket.ticketid]: e.target.value }))}
              />
              {ticket.tickettype === "Material Request" && (
                <Field
                  label={tr("tq.approved_budget")}
                  type="number"
                  min="0"
                  step="0.01"
                  value={approvedBudgets[ticket.ticketid] ?? ""}
                  disabled={busy}
                  onChange={(e) => setApprovedBudgets((cur) => ({ ...cur, [ticket.ticketid]: e.target.value }))}
                />
              )}
            </div>
            <div className="ticket-card-actions">
              <Button type="button" disabled={!assignments[ticket.ticketid] || busy} onClick={() => onAcknowledge(ticket)}>
                {busy ? tr("tq.assigning") : tr("tq.ack_assign")}
              </Button>
              <button type="button" className="ticket-reject-link" onClick={() => onReject(ticket)} disabled={busy}>{tr("expenses.reject")}</button>
            </div>
            {purchasers.length === 0 && <p className="ticket-card-warning">{tr("tq.no_purchasers")}</p>}
          </div>
        )
      )}

      {activeTab === "Acknowledged" && (
        <div className="ticket-card-foot ticket-card-foot-info">
          <span className="ticket-assigned-to">{tr("tq.with", { name: ticket.assignedtoname || tr("tq.a_purchaser") })}</span>
          {ticket.approvedbudget != null && <span className="ticket-approved-budget">{tr("tq.budget", { amount: PESO.format(Number(ticket.approvedbudget)) })}</span>}
        </div>
      )}

      {activeTab === "History" && (
        <div className="ticket-card-foot ticket-card-foot-info">
          {ticket.status === "Resolved" ? (
            <span className="ticket-hist-ok">{ticket.resolvedbyname ? tr("tq.resolved_by", { name: ticket.resolvedbyname }) : tv("status", "Resolved")}</span>
          ) : (
            <span className="ticket-hist-reject">
              {ticket.resolvedbyname ? tr("tq.rejected_by", { name: ticket.resolvedbyname }) : tr("tq.rejected")}
              {ticket.rejectionreason ? ` — ${ticket.rejectionreason}` : ""}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

// ---- Batch block: a group of tickets submitted together ----
function BatchBlock(props) {
  const { tickets, purchasers, setAssignments, submittingId, onAssignAll } = props;
  const { t: tr, formatDate } = useLocale();
  const first = tickets[0];
  const actionable = tickets.filter((t) => t.tickettype !== "Report");
  const busy = submittingId === `batch:${groupKey(first)}`;
  const [batchPurchaser, setBatchPurchaser] = useState("");

  function applyToAll(userId) {
    setBatchPurchaser(userId);
    if (!userId) return;
    setAssignments((cur) => {
      const next = { ...cur };
      for (const t of actionable) next[t.ticketid] = userId;
      return next;
    });
  }

  return (
    <section className="ticket-batch">
      <header className="ticket-batch-head">
        <div>
          <span className="ticket-batch-count">{tr("tq.batch_count", { count: tickets.length })}</span>
          <span className="ticket-batch-meta">
            {first.submittedbyname || "Site Manager"} · {(first.projectname || first.projectName)} · {formatDate(first.createdat, TIME_OPTIONS)}
          </span>
        </div>
        {actionable.length > 0 && (
          <div className="ticket-batch-assign">
            <span>{tr("tq.assign_all_to")}</span>
            <SearchableSelect
              inline
              value={batchPurchaser}
              disabled={busy || purchasers.length === 0}
              onChange={applyToAll}
              options={[
                { value: "", label: tr("tq.choose_purchaser"), pinned: true },
                ...purchasers.map((p) => ({ value: p.userid, label: p.name })),
              ]}
              placeholder={tr("tq.choose_purchaser")}
              searchPlaceholder={tr("ss.search_ph")}
              noMatchText={tr("ss.no_match", { query: "{query}" })}
            />
            <Button type="button" disabled={busy} onClick={() => onAssignAll(tickets)}>
              {busy ? tr("tq.assigning") : tr("tq.assign_all")}
            </Button>
          </div>
        )}
      </header>
      <div className="ticket-batch-body">
        {tickets.map((t) => (
          <TicketCard key={t.ticketid} {...props} ticket={t} inBatch />
        ))}
      </div>
    </section>
  );
}

// ---- Reject modal ----
function RejectModal({ state, busy, error, onToggleChip, onNote, onCancel, onSubmit }) {
  const { t: tr } = useLocale();
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="ticket-reject-title">
      <div className="modal modal-narrow">
        <div className="modal-head">
          <h2 id="ticket-reject-title" className="modal-title">{tr("tq.reject_title")}</h2>
          <button type="button" className="modal-close" onClick={onCancel} aria-label={tr("pd.close")}>×</button>
        </div>
        <p className="modal-sub">{tr("tq.reject_sub", { subject: state.ticket.subject })}</p>
        {error && <Banner tone="error" title={error} />}
        <div className="reject-chips">
          {REJECT_REASONS.map((key) => {
            const r = tr(key);
            return (
              <button
                key={key}
                type="button"
                className={"reject-chip" + (state.chips.has(key) ? " reject-chip-on" : "")}
                aria-pressed={state.chips.has(key)}
                onClick={() => onToggleChip(key)}
              >
                {r}
              </button>
            );
          })}
        </div>
        <Field
          label={tr("tq.add_note")}
          as="textarea"
          rows={3}
          value={state.note}
          onChange={(e) => onNote(e.target.value)}
          placeholder={tr("tq.note_ph")}
        />
        <div className="modal-actions">
          <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>{tr("common.cancel")}</Button>
          <Button variant="danger" type="button" onClick={onSubmit} disabled={busy}>
            {busy ? tr("tq.rejecting") : tr("tq.reject_title")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- Edit modal ----
function EditModal({ editing, editForm, setEditForm, editBusy, editError, vendors, onCancel, onSave }) {
  const { t: tr } = useLocale();
  const t = editing.ticket;
  const isReport = t.tickettype === "Report";
  const isMR = t.tickettype === "Material Request";
  const isWork = t.tickettype === "Work Item";
  const onBom = t.bomitemid != null;
  const upd = (k) => (e) => setEditForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="ticket-edit-title">
      <div className="modal modal-ticket">
        <div className="modal-head">
          <h2 id="ticket-edit-title" className="modal-title">{tr("tq.edit_title")}</h2>
          <button type="button" className="modal-close" onClick={onCancel} aria-label={tr("pd.close")}>×</button>
        </div>
        {editError && <Banner tone="error" title={editError} />}
        <div className="edit-grid">
          <Field label={tr("tf.subject")} value={editForm.subject} onChange={upd("subject")} required />
          <Field label={tr("submit.description")} as="textarea" rows={2} value={editForm.description} onChange={upd("description")} />
          {(isMR || isWork) && (
            <div className="edit-row">
              <Field label={tr("bom.aria_quantity")} type="number" min="0" step="0.01" value={editForm.quantity} onChange={upd("quantity")} required />
              {onBom ? (
                <Field label={tr("tq.unit_from_bom")} value={t.unit || ""} disabled readOnly />
              ) : (
                <Field label={tr("bom.col_unit")} as="select" value={editForm.unit} onChange={upd("unit")} required>
                  <option value="">{tr("tq.choose")}</option>
                  {UNIT_OPTIONS.map((u) => (<option key={u} value={u}>{u}</option>))}
                </Field>
              )}
            </div>
          )}
          {(isMR && !onBom) || isWork ? (
            <Field label={tr("tq.material")} value={editForm.materialType} onChange={upd("materialType")} required />
          ) : null}
          {isMR && onBom && (
            <Field label={tr("tq.material_locked")} value={t.materialtype || ""} disabled readOnly />
          )}
          {isMR && !onBom && (
            <Field label={tr("tf.not_in_bom_reason")} as="textarea" rows={2} value={editForm.notInBomReason} onChange={upd("notInBomReason")} required />
          )}
          {(isMR || isWork) && (
            <Field label={tr("tq.pref_vendor")} as="select" value={editForm.vendorName} onChange={upd("vendorName")}>
              <option value="">{tr("split.none")}</option>
              {vendors.map((v) => (<option key={v.vendorID} value={v.vendorName}>{v.vendorName}</option>))}
            </Field>
          )}
          {isMR && (
            <Field label={tr("tq.sm_budget")} type="number" min="0" step="0.01" value={editForm.requestedBudget} onChange={upd("requestedBudget")} required />
          )}
          {isReport && <p className="modal-sub">{tr("tq.report_only")}</p>}
        </div>
        <div className="modal-actions">
          <Button variant="secondary" type="button" onClick={onCancel} disabled={editBusy}>{tr("common.cancel")}</Button>
          <Button type="button" onClick={onSave} disabled={editBusy}>{editBusy ? tr("common.saving") : tr("projects.save_changes")}</Button>
        </div>
      </div>
    </div>
  );
}