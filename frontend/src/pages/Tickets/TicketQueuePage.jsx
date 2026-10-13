import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { listPendingTickets, listPurchasers, acknowledgeTicket, resolveTicket } from "../../api/ticketsApi";
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
  // Deep-link from the dashboard "Needs your attention" panel: ?focus=<id>
  // scrolls to that ticket's card and highlights it briefly.
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("focus");
  const [highlightId, setHighlightId] = useState(null);

  async function loadQueue() {
    setLoading(true);
    setError("");
    try {
      const [pending, availablePurchasers] = await Promise.all([
        listPendingTickets(),
        listPurchasers(),
      ]);
      setTickets(pending);
      setPurchasers(availablePurchasers);
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

  // A PM-created ticket is born Acknowledged and lands in the Purchaser's
  // queue, not this Pending one. The form shows its own confirmation step, so
  // here we just refresh the queue in the background; the PM closes the modal
  // when done (or creates another).
  function handleCreated() {
    loadQueue();
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
                  <time className="ticket-card-date" dateTime={ticket.createdat}>
                    {DATE.format(new Date(ticket.createdat))}
                  </time>
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
              </article>
            );
          })}
        </div>
      )}

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