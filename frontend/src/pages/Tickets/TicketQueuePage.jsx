import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { listPendingTickets, listPurchasers, listApprovedVendors, acknowledgeTicket, resolveTicket, updateTicket, rejectTicket } from "../../api/ticketsApi";
import { extractErrorMessage } from "../../api/client";
import { Badge } from "../../components/ui/Badge";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { TicketForm } from "../../components/tickets/TicketForm";
import "./TicketQueuePage.css";

const DATE = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });
const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });

// Ticket type drives everything the PM does with a ticket, so it's the primary
// visual key: a colored spine down each card + a matching type pill. The tone
// maps to CSS classes, not inline colors, so light/dark stays in the tokens.
const TYPE_META = {
  "Material Request": { key: "material", label: "Material Request" },
  "Work Item": { key: "work", label: "Work Item" },
  Report: { key: "report", label: "Report" },
};

// Filter bar: "All" plus one entry per type, each showing a live count.
const TYPE_FILTERS = ["All", "Material Request", "Work Item", "Report"];

// Units offered when the PM edits a not-in-BOM Material Request or a Work Item.
// (An on-BOM Material Request keeps the BOM item's unit, shown read-only.)
const UNIT_OPTIONS = [
  "pcs", "set", "lot", "unit",
  "kg", "g", "L", "mL",
  "m", "cm", "mm", "sq.m", "cu.m",
  "bag", "box", "roll", "sheet", "pair", "bundle", "gal", "can", "truckload",
];

export function TicketQueuePage() {
  const [tickets, setTickets] = useState([]);
  const [purchasers, setPurchasers] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [approvedBudgets, setApprovedBudgets] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submittingId, setSubmittingId] = useState(null);
  const [activeType, setActiveType] = useState("All");
  const [createOpen, setCreateOpen] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [rejectReasons, setRejectReasons] = useState({}); // { [ticketid]: reason }
  const [rejectOpenId, setRejectOpenId] = useState(null); // which card's reject row is shown
  // Edit a pending ticket: { ticket } while the modal is open.
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  // Deep-link from the dashboard "Needs your attention" panel: ?focus=<id>
  // scrolls to that ticket's card and highlights it briefly.
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("focus");
  const [highlightId, setHighlightId] = useState(null);

  async function loadQueue() {
    setLoading(true);
    setError("");
    try {
      const [pending, availablePurchasers, approvedVendors] = await Promise.all([
        listPendingTickets(),
        listPurchasers(),
        listApprovedVendors().catch(() => []),
      ]);
      setTickets(pending);
      setPurchasers(availablePurchasers);
      setVendors(approvedVendors);
      setAssignments((current) => {
        const next = { ...current };
        for (const ticket of pending) {
          if (!next[ticket.ticketid] && availablePurchasers[0]) {
            next[ticket.ticketid] = availablePurchasers[0].userid;
          }
        }
        return next;
      });
      setApprovedBudgets((current) => {
        const next = { ...current };
        for (const ticket of pending) {
          if (next[ticket.ticketid] === undefined) {
            next[ticket.ticketid] = ticket.requestedbudget == null ? "" : String(ticket.requestedbudget);
          }
        }
        return next;
      });
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't load the pending ticket queue."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQueue();
  }, []);

  // Once tickets are loaded, if we arrived with ?focus=<id> and that ticket is
  // in the queue, clear any type filter hiding it, scroll it into view and
  // flash a highlight. rAF waits for the filter reset to paint first.
  useEffect(() => {
    if (!focusId || loading) return undefined;
    if (!tickets.some((t) => String(t.ticketid) === String(focusId))) return undefined;
    setActiveType("All");
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`ticket-${focusId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    setHighlightId(focusId);
    const timer = setTimeout(() => setHighlightId(null), 2500);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, [focusId, loading, tickets]);

  async function handleAcknowledge(ticket) {
    const assignedTo = assignments[ticket.ticketid];
    if (!assignedTo) return;
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
      setTickets((current) => current.filter((item) => item.ticketid !== ticket.ticketid));
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't acknowledge this ticket."));
    } finally {
      setSubmittingId(null);
    }
  }

  // Report tickets are resolved directly by the PM (no Purchaser, no budget) —
  // the backend takes Pending Report -> Resolved via PATCH /:id/resolve.
  async function handleResolve(ticket) {
    setSubmittingId(ticket.ticketid);
    setError("");
    try {
      await resolveTicket(ticket.ticketid);
      setTickets((current) => current.filter((item) => item.ticketid !== ticket.ticketid));
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't resolve this report."));
    } finally {
      setSubmittingId(null);
    }
  }

  // The PM rejects a wrong/invalid request with a reason (Pending -> Rejected).
  async function handleReject(ticket) {
    const reason = (rejectReasons[ticket.ticketid] || "").trim();
    if (!reason) {
      setError("Enter a reason before rejecting this ticket.");
      return;
    }
    setSubmittingId(ticket.ticketid);
    setError("");
    try {
      await rejectTicket(ticket.ticketid, reason);
      setTickets((current) => current.filter((item) => item.ticketid !== ticket.ticketid));
      setRejectOpenId(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't reject this ticket."));
    } finally {
      setSubmittingId(null);
    }
  }

  // A PM-created ticket is born Acknowledged and lands in the Purchaser's
  // queue, not this Pending one. The form shows its own confirmation step, so
  // here we just refresh the queue in the background; the PM closes the modal
  // when done (or creates another).
  function handleCreated() {
    loadQueue();
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
    const isReport = t.tickettype === "Report";
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
      payload.vendorName = editForm.vendorName; // "" → cleared server-side
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
      // Keep the budget input in the assign row in sync with the new figure.
      setApprovedBudgets((cur) => ({ ...cur, [t.ticketid]: updated.requestedbudget == null ? "" : String(updated.requestedbudget) }));
      setEditing(null);
      setEditForm(null);
    } catch (err) {
      setEditError(extractErrorMessage(err, "Couldn't save the changes."));
    } finally {
      setEditBusy(false);
    }
  }

  const counts = useMemo(() => {
    const byType = { All: tickets.length };
    for (const t of tickets) byType[t.tickettype] = (byType[t.tickettype] || 0) + 1;
    return byType;
  }, [tickets]);

  const visibleTickets = activeType === "All"
    ? tickets
    : tickets.filter((t) => t.tickettype === activeType);

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

      {error && <Banner tone="error" title={error} />}

      {!loading && tickets.length > 0 && (
        <div className="ticket-queue-filters" role="tablist" aria-label="Filter by type">
          {TYPE_FILTERS.map((type) => {
            const count = counts[type] || 0;
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
      )}

      {loading && <p className="ticket-queue-loading">Loading pending tickets…</p>}

      {!loading && tickets.length === 0 && (
        <div className="ticket-queue-empty">
          <h2>You’re all caught up</h2>
          <p>New requests from Site Managers will appear here. You can also raise one yourself with “New ticket”.</p>
        </div>
      )}

      {!loading && tickets.length > 0 && visibleTickets.length === 0 && (
        <div className="ticket-queue-empty ticket-queue-empty-filtered">
          <p>No {TYPE_META[activeType]?.label.toLowerCase()} tickets waiting.</p>
        </div>
      )}

      {!loading && visibleTickets.length > 0 && (
        <div className="ticket-queue-list">
          {visibleTickets.map((ticket) => {
            const meta = TYPE_META[ticket.tickettype] || { key: "work", label: ticket.tickettype };
            const isReport = ticket.tickettype === "Report";
            const busy = submittingId === ticket.ticketid;
            return (
              <article
                key={ticket.ticketid}
                id={`ticket-${ticket.ticketid}`}
                className={`ticket-card ticket-card-${meta.key}` + (String(ticket.ticketid) === String(highlightId) ? " ticket-card-focus" : "")}
              >
                <div className="ticket-card-head">
                  <div className="ticket-card-head-main">
                    <div className="ticket-card-tags">
                      <span className={`ticket-type-pill ticket-type-pill-${meta.key}`}>{meta.label}</span>
                      <Badge status={ticket.status} />
                    </div>
                    <h2 className="ticket-card-subject">{ticket.subject}</h2>
                    <p className="ticket-card-context">
                      {ticket.projectname || ticket.projectName} · Submitted by {ticket.submittedbyname || "Site Manager"}
                    </p>
                  </div>
                  <div className="ticket-card-head-side">
                    <time className="ticket-card-date" dateTime={ticket.createdat}>
                      {DATE.format(new Date(ticket.createdat))}
                    </time>
                    <button type="button" className="ticket-card-edit" onClick={() => openEdit(ticket)}>
                      Edit
                    </button>
                  </div>
                </div>

                {ticket.description && <p className="ticket-card-description">{ticket.description}</p>}

                {!isReport && (ticket.materialtype || ticket.quantity || ticket.vendorname) && (
                  <dl className="ticket-card-facts">
                    <div><dt>Material</dt><dd>{ticket.materialtype || "—"}</dd></div>
                    <div><dt>Quantity</dt><dd>{ticket.quantity != null ? `${ticket.quantity}${ticket.unit ? ` ${ticket.unit}` : ""}` : "—"}</dd></div>
                    <div><dt>Preferred vendor</dt><dd>{ticket.vendorname || "—"}</dd></div>
                    {ticket.tickettype === "Material Request" && (
                      <div>
                        <dt>SM requested budget</dt>
                        <dd>{ticket.requestedbudget == null ? "Not provided" : PESO.format(Number(ticket.requestedbudget))}</dd>
                      </div>
                    )}
                  </dl>
                )}

                {isReport ? (
                  <div className="ticket-card-foot ticket-card-foot-report">
                    <p className="ticket-card-context">Issue report — resolve it once it has been handled on site.</p>
                    <Button type="button" disabled={busy} onClick={() => handleResolve(ticket)}>
                      {busy ? "Resolving…" : "Resolve report"}
                    </Button>
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
                    <Button
                      type="button"
                      disabled={!assignments[ticket.ticketid] || busy}
                      onClick={() => handleAcknowledge(ticket)}
                    >
                      {busy ? "Assigning…" : "Acknowledge & Assign"}
                    </Button>
                    {purchasers.length === 0 && (
                      <p className="ticket-card-warning">There are no active Purchasers available to assign.</p>
                    )}
                  </div>
                )}

                {rejectOpenId === ticket.ticketid ? (
                  <div className="ticket-card-reject">
                    <input
                      type="text"
                      className="ticket-reject-input"
                      placeholder="Reason for rejecting"
                      value={rejectReasons[ticket.ticketid] || ""}
                      disabled={busy}
                      onChange={(e) => setRejectReasons((cur) => ({ ...cur, [ticket.ticketid]: e.target.value }))}
                    />
                    <Button variant="danger" type="button" disabled={busy || !(rejectReasons[ticket.ticketid] || "").trim()} onClick={() => handleReject(ticket)}>
                      {busy ? "Rejecting…" : "Reject"}
                    </Button>
                    <Button variant="secondary" type="button" disabled={busy} onClick={() => setRejectOpenId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <button type="button" className="ticket-card-reject-toggle" onClick={() => setRejectOpenId(ticket.ticketid)}>
                    Reject this request
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}

      {editing && editForm && (() => {
        const t = editing.ticket;
        const isReport = t.tickettype === "Report";
        const isMR = t.tickettype === "Material Request";
        const isWork = t.tickettype === "Work Item";
        const onBom = t.bomitemid != null;
        const upd = (patch) => { setEditForm((f) => ({ ...f, ...patch })); setEditError(""); };
        return (
          <div className="modal-overlay" role="presentation" onClick={closeEdit}>
            <div className="modal modal-ticket" role="dialog" aria-modal="true" aria-labelledby="ticket-edit-title" onClick={(ev) => ev.stopPropagation()}>
              <h2 id="ticket-edit-title" className="modal-title">Edit ticket</h2>
              <p className="modal-body">{t.tickettype} · {t.projectname || t.projectName}</p>

              <Field
                label="Subject"
                value={editForm.subject}
                onChange={(e) => upd({ subject: e.target.value })}
              />
              <Field
                label="Description / context"
                as="textarea"
                value={editForm.description}
                onChange={(e) => upd({ description: e.target.value })}
              />

              {((isMR && !onBom) || isWork) && (
                <Field
                  label="Material"
                  value={editForm.materialType}
                  onChange={(e) => upd({ materialType: e.target.value })}
                />
              )}
              {isMR && onBom && (
                <p className="ticket-edit-locked">Material and unit follow the BOM item and can't be changed here.</p>
              )}

              {!isReport && (
                <div className="ticket-edit-qty-row">
                  <Field
                    label="Quantity"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={editForm.quantity}
                    onChange={(e) => upd({ quantity: e.target.value })}
                  />
                  {isMR && onBom ? (
                    <Field label="Unit" value={t.unit || "—"} readOnly disabled />
                  ) : (
                    <Field label="Unit" as="select" value={editForm.unit} onChange={(e) => upd({ unit: e.target.value })}>
                      <option value="">Select a unit</option>
                      {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </Field>
                  )}
                </div>
              )}

              {isMR && !onBom && (
                <Field
                  label="Reason it isn't in the BOM"
                  as="textarea"
                  value={editForm.notInBomReason}
                  onChange={(e) => upd({ notInBomReason: e.target.value })}
                />
              )}

              {!isReport && (
                <Field label="Preferred vendor" as="select" value={editForm.vendorName} onChange={(e) => upd({ vendorName: e.target.value })}>
                  <option value="">Not sure yet</option>
                  {vendors.map((v) => <option key={v.vendorID} value={v.vendorName}>{v.vendorName}</option>)}
                </Field>
              )}

              {isMR && (
                <Field
                  label="Requested budget (PHP)"
                  type="number"
                  min="0"
                  step="0.01"
                  value={editForm.requestedBudget}
                  onChange={(e) => upd({ requestedBudget: e.target.value })}
                />
              )}

              {editError && <Banner tone="error" title={editError} />}
              <div className="modal-actions">
                <Button variant="secondary" onClick={closeEdit} disabled={editBusy}>Cancel</Button>
                <Button onClick={handleEditSave} disabled={editBusy}>{editBusy ? "Saving…" : "Save changes"}</Button>
              </div>
            </div>
          </div>
        );
      })()}

      {createOpen && (
        <div className="modal-overlay" role="presentation" onClick={() => setCreateOpen(false)}>
          <div
            className="modal modal-ticket"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ticket-create-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h2 id="ticket-create-title" className="modal-title">New ticket</h2>
            <p className="modal-body">
              Raise a Material Request or Work Item and send it straight to a Purchaser.
            </p>
            <TicketForm onSuccess={handleCreated} onClose={() => setCreateOpen(false)} onCancel={() => setCreateOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}