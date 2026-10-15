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
import { TicketForm } from "../../components/tickets/TicketForm";
import "./TicketQueuePage.css";

const DATE = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });
const TIME = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" });
const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });
const QTY = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 });

const TYPE_META = {
  "Material Request": { key: "material", label: "Material Request" },
  "Work Item": { key: "work", label: "Work Item" },
  Report: { key: "report", label: "Report" },
};

// The three status views the PM moves a ticket through.
const TABS = [
  { key: "Pending", label: "Needs action" },
  { key: "Acknowledged", label: "With purchaser" },
  { key: "History", label: "History" },
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
const REJECT_REASONS = [
  "Quantity exceeds BOM",
  "Duplicate request",
  "Wrong material",
  "Not needed this phase",
];

// A batch submitted from mobile is several tickets created in one transaction,
// so every ticket in it shares an exact createdAt. Group by submitter+createdAt.
function groupKey(t) {
  return `${t.submittedby}|${t.createdat}`;
}

export function TicketQueuePage() {
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
      setError(extractErrorMessage(err, "Couldn't load tickets."));
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
      setError("Choose a Purchaser before assigning this ticket.");
      return;
    }
    const budgetText = approvedBudgets[ticket.ticketid] ?? "";
    const approvedBudget = ticket.tickettype === "Material Request" ? Number(budgetText) : undefined;
    if (ticket.tickettype === "Material Request" && (budgetText === "" || !Number.isFinite(approvedBudget) || approvedBudget < 0)) {
      setError("Enter a confirmed budget of 0 or more before acknowledging this Material Request.");
      return;
    }
    setSubmittingId(ticket.ticketid);
    setError("");
    try {
      await acknowledgeTicket(ticket.ticketid, assignedTo, approvedBudget);
      removeFromView(ticket.ticketid);
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't acknowledge this ticket."));
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
      setError("Choose a Purchaser on every request in this batch first (or assign them one by one).");
      return;
    }
    setError("");
    setSubmittingId(`batch:${groupKey(group[0])}`);
    const failures = [];
    for (const t of actionable) {
      const budgetText = approvedBudgets[t.ticketid] ?? "";
      const approvedBudget = t.tickettype === "Material Request" ? Number(budgetText) : undefined;
      if (t.tickettype === "Material Request" && (budgetText === "" || !Number.isFinite(approvedBudget) || approvedBudget < 0)) {
        failures.push(`${t.subject}: budget`);
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await acknowledgeTicket(t.ticketid, assignments[t.ticketid], approvedBudget);
        removeFromView(t.ticketid);
      } catch (err) {
        failures.push(`${t.subject}: ${extractErrorMessage(err, "failed")}`);
      }
    }
    setSubmittingId(null);
    if (failures.length > 0) setError(`Some requests couldn't be assigned — ${failures.join("; ")}`);
  }

  async function handleResolve(ticket) {
    setSubmittingId(ticket.ticketid);
    setError("");
    try {
      await resolveTicket(ticket.ticketid);
      removeFromView(ticket.ticketid);
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't resolve this report."));
    } finally {
      setSubmittingId(null);
    }
  }

  function openReject(ticket) {
    setRejectError("");
    setReject({ ticket, chips: new Set(), note: "" });
  }
  function toggleRejectChip(reasonText) {
    setReject((r) => {
      const chips = new Set(r.chips);
      if (chips.has(reasonText)) chips.delete(reasonText);
      else chips.add(reasonText);
      return { ...r, chips };
    });
  }
  function composedReason(r) {
    const parts = [...r.chips];
    const note = r.note.trim();
    if (note) parts.push(note);
    return parts.join(" — ");
  }
  async function handleRejectSubmit() {
    if (!reject) return;
    const reason = composedReason(reject);
    if (!reason) {
      setRejectError("Pick a reason or write one so the Site Manager knows what to fix.");
      return;
    }
    setRejectBusy(true);
    setRejectError("");
    try {
      await rejectTicket(reject.ticket.ticketid, reason);
      removeFromView(reject.ticket.ticketid);
      setReject(null);
    } catch (err) {
      setRejectError(extractErrorMessage(err, "Couldn't reject this ticket."));
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

    if (!editForm.subject.trim()) { setEditError("Subject is required."); return; }
    const payload = {
      subject: editForm.subject.trim(),
      description: editForm.description.trim() || undefined,
    };
    if (isMR || isWork) {
      const q = Number(editForm.quantity);
      if (!Number.isFinite(q) || q <= 0) { setEditError("Enter a quantity greater than 0."); return; }
      payload.quantity = q;
      payload.vendorName = editForm.vendorName;
    }
    if (isMR) {
      const b = Number(editForm.requestedBudget);
      if (!Number.isFinite(b) || b < 0) { setEditError("Enter a requested budget of 0 or more."); return; }
      payload.requestedBudget = b;
    }
    if ((isMR && !onBom) || isWork) {
      if (!editForm.materialType.trim()) { setEditError("Material is required."); return; }
      if (!editForm.unit.trim()) { setEditError("Choose a unit."); return; }
      payload.materialType = editForm.materialType.trim();
      payload.unit = editForm.unit;
    }
    if (isMR && !onBom) {
      if (!editForm.notInBomReason.trim()) { setEditError("Give a reason it isn't in the BOM."); return; }
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
      setEditError(extractErrorMessage(err, "Couldn't save the changes."));
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
          <h1>Tickets</h1>
          <p className="ticket-queue-subtitle">
            Requests from the field land here. Confirm a budget and assign a Purchaser, or resolve a report — or raise a new ticket yourself.
          </p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>New ticket</Button>
      </div>

      <div className="ticket-tabs" role="tablist" aria-label="Ticket status">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={"ticket-tab" + (activeTab === tab.key ? " ticket-tab-active" : "")}
            onClick={() => { setActiveTab(tab.key); setActiveType("All"); }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <Banner tone="error" title={error} />}

      {!loading && tickets.length > 0 && (
        <div className="ticket-queue-controls">
          <div className="ticket-queue-filters" role="tablist" aria-label="Filter by type">
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
                  {type === "All" ? "All" : meta.label}
                  <span className="ticket-filter-count">{count}</span>
                </button>
              );
            })}
          </div>

          {projects.length > 1 && (
            <label className="ticket-project-filter">
              <span>Project</span>
              <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
                <option value="All">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {loading && <p className="ticket-queue-loading">Loading tickets…</p>}

      {!loading && tickets.length === 0 && (
        <div className="ticket-queue-empty">
          <h2>{activeTab === "Pending" ? "You’re all caught up" : activeTab === "Acknowledged" ? "Nothing with a purchaser" : "No history yet"}</h2>
          <p>
            {activeTab === "Pending" && "New requests from Site Managers will appear here. You can also raise one yourself with “New ticket”."}
            {activeTab === "Acknowledged" && "Tickets you’ve assigned to a Purchaser will show here until they’re resolved."}
            {activeTab === "History" && "Resolved and rejected tickets will be listed here."}
          </p>
        </div>
      )}

      {!loading && tickets.length > 0 && visibleTickets.length === 0 && (
        <div className="ticket-queue-empty ticket-queue-empty-filtered">
          <p>Nothing matches this filter.</p>
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
              <h2 id="ticket-create-title" className="modal-title">New ticket</h2>
              <button type="button" className="modal-close" onClick={() => setCreateOpen(false)} aria-label="Close">×</button>
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
  if (ticket.tickettype !== "Material Request" || ticket.bomitemid == null || ticket.bomUnitCost == null) {
    if (ticket.tickettype === "Material Request" && ticket.notinbom) {
      return (
        <div className="bom-strip bom-strip-off">
          <span className="bom-strip-tag">Not in BOM</span>
          <span className="bom-strip-reason">{ticket.notinbomreason || "No reason given."}</span>
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
      <span className="bom-strip-tag">BOM</span>
      <span className="bom-strip-fact">{QTY.format(bomQty)} {unit} @ {PESO.format(unitCost)}</span>
      <span className="bom-strip-sep">·</span>
      <span className="bom-strip-fact">already requested {QTY.format(already)}</span>
      <span className="bom-strip-sep">·</span>
      <span className="bom-strip-fact">this request {QTY.format(thisQty)}</span>
      <span className="bom-strip-arrow">→</span>
      {over > 0
        ? <span className="bom-strip-flag">{QTY.format(over)} {unit} over BOM</span>
        : <span className="bom-strip-ok">{QTY.format(bomQty - projected)} {unit} left</span>}
    </div>
  );
}

// ---- A single ticket card ----
function TicketCard(props) {
  const {
    ticket, purchasers, assignments, setAssignments, approvedBudgets, setApprovedBudgets,
    submittingId, highlightId, activeTab, onAcknowledge, onResolve, onReject, onEdit, inBatch,
  } = props;
  const meta = TYPE_META[ticket.tickettype] || { key: "work", label: ticket.tickettype };
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
            <span className={`ticket-type-pill ticket-type-pill-${meta.key}`}>{meta.label}</span>
            <Badge status={ticket.status} />
            {ticket.resubmittedfromid && <span className="ticket-resubmit-pill">Resubmission</span>}
            {ticket.wasResubmitted && <span className="ticket-resubmit-pill ticket-resubmit-pill-done">Resubmitted</span>}
          </div>
          <h2 className="ticket-card-subject">{ticket.subject}</h2>
          <p className="ticket-card-context">
            {(ticket.projectname || ticket.projectName)} · Submitted by {ticket.submittedbyname || "Site Manager"}
          </p>
        </div>
        <div className="ticket-card-head-side">
          <time className="ticket-card-date" dateTime={ticket.createdat}>{DATE.format(new Date(ticket.createdat))}</time>
          {activeTab === "Pending" && (
            <button type="button" className="ticket-card-edit" onClick={() => onEdit(ticket)} disabled={busy}>Edit</button>
          )}
        </div>
      </div>

      {ticket.resubmittedfromid && ticket.resubmitOfReason && (
        <p className="ticket-resubmit-note">
          Previously rejected: “{ticket.resubmitOfReason}”
        </p>
      )}

      {ticket.description && <p className="ticket-card-description">{ticket.description}</p>}

      {!isReport && (ticket.materialtype || ticket.quantity || ticket.vendorname) && (
        <dl className="ticket-card-facts">
          <div><dt>Material</dt><dd>{ticket.materialtype || "—"}</dd></div>
          <div><dt>Quantity</dt><dd>{ticket.quantity != null ? `${QTY.format(ticket.quantity)}${ticket.unit ? ` ${ticket.unit}` : ""}` : "—"}</dd></div>
          <div><dt>Preferred vendor</dt><dd>{ticket.vendorname || "—"}</dd></div>
          {ticket.tickettype === "Material Request" && (
            <div><dt>SM requested budget</dt><dd>{ticket.requestedbudget == null ? "Not provided" : PESO.format(Number(ticket.requestedbudget))}</dd></div>
          )}
        </dl>
      )}

      <BomStrip ticket={ticket} />

      {/* Action area depends on the tab. */}
      {activeTab === "Pending" && (
        isReport ? (
          <div className="ticket-card-foot ticket-card-foot-report">
            <p className="ticket-card-context">Issue report — resolve it once it has been handled on site.</p>
            <div className="ticket-card-actions">
              <Button type="button" disabled={busy} onClick={() => onResolve(ticket)}>
                {busy ? "Resolving…" : "Resolve report"}
              </Button>
              <button type="button" className="ticket-reject-link" onClick={() => onReject(ticket)} disabled={busy}>Reject</button>
            </div>
          </div>
        ) : (
          <div className="ticket-card-foot">
            <div className="ticket-card-assign">
              <Field
                label="Assign Purchaser"
                as="select"
                value={assignments[ticket.ticketid] || ""}
                disabled={busy || purchasers.length === 0}
                onChange={(e) => setAssignments((cur) => ({ ...cur, [ticket.ticketid]: e.target.value }))}
              >
                <option value="">Select a Purchaser</option>
                {purchasers.map((p) => (
                  <option key={p.userid} value={p.userid}>{p.name} ({p.email})</option>
                ))}
              </Field>
              {ticket.tickettype === "Material Request" && (
                <Field
                  label="Approved budget (₱)"
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
                {busy ? "Assigning…" : "Acknowledge & Assign"}
              </Button>
              <button type="button" className="ticket-reject-link" onClick={() => onReject(ticket)} disabled={busy}>Reject</button>
            </div>
            {purchasers.length === 0 && <p className="ticket-card-warning">There are no active Purchasers available to assign.</p>}
          </div>
        )
      )}

      {activeTab === "Acknowledged" && (
        <div className="ticket-card-foot ticket-card-foot-info">
          <span className="ticket-assigned-to">With {ticket.assignedtoname || "a purchaser"}</span>
          {ticket.approvedbudget != null && <span className="ticket-approved-budget">Budget {PESO.format(Number(ticket.approvedbudget))}</span>}
        </div>
      )}

      {activeTab === "History" && (
        <div className="ticket-card-foot ticket-card-foot-info">
          {ticket.status === "Resolved" ? (
            <span className="ticket-hist-ok">Resolved{ticket.resolvedbyname ? ` by ${ticket.resolvedbyname}` : ""}</span>
          ) : (
            <span className="ticket-hist-reject">
              Rejected{ticket.resolvedbyname ? ` by ${ticket.resolvedbyname}` : ""}
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
          <span className="ticket-batch-count">{tickets.length} requests</span>
          <span className="ticket-batch-meta">
            {first.submittedbyname || "Site Manager"} · {(first.projectname || first.projectName)} · {TIME.format(new Date(first.createdat))}
          </span>
        </div>
        {actionable.length > 0 && (
          <label className="ticket-batch-assign">
            <span>Assign all to</span>
            <select value={batchPurchaser} disabled={busy || purchasers.length === 0} onChange={(e) => applyToAll(e.target.value)}>
              <option value="">Choose a Purchaser…</option>
              {purchasers.map((p) => (<option key={p.userid} value={p.userid}>{p.name}</option>))}
            </select>
            <Button type="button" disabled={busy} onClick={() => onAssignAll(tickets)}>
              {busy ? "Assigning…" : "Assign all"}
            </Button>
          </label>
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
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="ticket-reject-title">
      <div className="modal modal-narrow">
        <div className="modal-head">
          <h2 id="ticket-reject-title" className="modal-title">Reject request</h2>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">×</button>
        </div>
        <p className="modal-sub">“{state.ticket.subject}” — the Site Manager will see your reason.</p>
        {error && <Banner tone="error" title={error} />}
        <div className="reject-chips">
          {REJECT_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              className={"reject-chip" + (state.chips.has(r) ? " reject-chip-on" : "")}
              aria-pressed={state.chips.has(r)}
              onClick={() => onToggleChip(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <Field
          label="Add a note (optional)"
          as="textarea"
          rows={3}
          value={state.note}
          onChange={(e) => onNote(e.target.value)}
          placeholder="Anything else the Site Manager should know"
        />
        <div className="modal-actions">
          <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="danger" type="button" onClick={onSubmit} disabled={busy}>
            {busy ? "Rejecting…" : "Reject request"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- Edit modal ----
function EditModal({ editing, editForm, setEditForm, editBusy, editError, vendors, onCancel, onSave }) {
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
          <h2 id="ticket-edit-title" className="modal-title">Edit ticket</h2>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">×</button>
        </div>
        {editError && <Banner tone="error" title={editError} />}
        <div className="edit-grid">
          <Field label="Subject" value={editForm.subject} onChange={upd("subject")} required />
          <Field label="Description" as="textarea" rows={2} value={editForm.description} onChange={upd("description")} />
          {(isMR || isWork) && (
            <div className="edit-row">
              <Field label="Quantity" type="number" min="0" step="0.01" value={editForm.quantity} onChange={upd("quantity")} required />
              {onBom ? (
                <Field label="Unit (from BOM)" value={t.unit || ""} disabled readOnly />
              ) : (
                <Field label="Unit" as="select" value={editForm.unit} onChange={upd("unit")} required>
                  <option value="">Choose…</option>
                  {UNIT_OPTIONS.map((u) => (<option key={u} value={u}>{u}</option>))}
                </Field>
              )}
            </div>
          )}
          {(isMR && !onBom) || isWork ? (
            <Field label="Material" value={editForm.materialType} onChange={upd("materialType")} required />
          ) : null}
          {isMR && onBom && (
            <Field label="Material (locked to BOM)" value={t.materialtype || ""} disabled readOnly />
          )}
          {isMR && !onBom && (
            <Field label="Reason it isn’t in the BOM" as="textarea" rows={2} value={editForm.notInBomReason} onChange={upd("notInBomReason")} required />
          )}
          {(isMR || isWork) && (
            <Field label="Preferred vendor" as="select" value={editForm.vendorName} onChange={upd("vendorName")}>
              <option value="">None</option>
              {vendors.map((v) => (<option key={v.vendorID} value={v.vendorName}>{v.vendorName}</option>))}
            </Field>
          )}
          {isMR && (
            <Field label="SM requested budget (₱)" type="number" min="0" step="0.01" value={editForm.requestedBudget} onChange={upd("requestedBudget")} required />
          )}
          {isReport && <p className="modal-sub">Reports only carry a subject and description.</p>}
        </div>
        <div className="modal-actions">
          <Button variant="secondary" type="button" onClick={onCancel} disabled={editBusy}>Cancel</Button>
          <Button type="button" onClick={onSave} disabled={editBusy}>{editBusy ? "Saving…" : "Save changes"}</Button>
        </div>
      </div>
    </div>
  );
}