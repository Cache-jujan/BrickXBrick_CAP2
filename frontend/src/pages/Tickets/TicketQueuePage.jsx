import { useEffect, useState } from "react";
import { listPendingTickets, listPurchasers, acknowledgeTicket } from "../../api/ticketsApi";
import { extractErrorMessage } from "../../api/client";
import { Badge } from "../../components/ui/Badge";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import "./TicketQueuePage.css";

const DATE = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

export function TicketQueuePage() {
  const [tickets, setTickets] = useState([]);
  const [purchasers, setPurchasers] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submittingId, setSubmittingId] = useState(null);

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
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't load the pending ticket queue."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQueue();
  }, []);

  async function handleAcknowledge(ticket) {
    const assignedTo = assignments[ticket.ticketid];
    if (!assignedTo) return;
    setSubmittingId(ticket.ticketid);
    setError("");
    try {
      await acknowledgeTicket(ticket.ticketid, assignedTo);
      setTickets((current) => current.filter((item) => item.ticketid !== ticket.ticketid));
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't acknowledge this ticket."));
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <div className="ticket-queue">
      <div className="ticket-queue-header">
        <div>
          <h1>Ticket Queue</h1>
          <p className="ticket-queue-subtitle">Review pending requests and assign each one to a Purchaser.</p>
        </div>
        <Button variant="secondary" type="button" onClick={loadQueue} disabled={loading}>Refresh</Button>
      </div>

      {error && <Banner tone="error" title={error} />}
      {loading && <p className="ticket-queue-loading">Loading pending tickets…</p>}
      {!loading && tickets.length === 0 && (
        <Card className="ticket-queue-empty"><h2>Queue is clear</h2><p>New Site Manager requests will appear here when they are submitted.</p></Card>
      )}
      {!loading && tickets.length > 0 && (
        <div className="ticket-queue-list">
          {tickets.map((ticket) => (
            <Card key={ticket.ticketid} className="ticket-queue-card">
              <div className="ticket-queue-card-top">
                <div>
                  <div className="ticket-queue-meta"><Badge status={ticket.status} /><span>{ticket.tickettype}</span></div>
                  <h2>{ticket.subject}</h2>
                  <p className="ticket-queue-context">{ticket.projectname || ticket.projectName} · Submitted by {ticket.submittedbyname || "Site Manager"}</p>
                </div>
                <time dateTime={ticket.createdat}>{DATE.format(new Date(ticket.createdat))}</time>
              </div>
              {ticket.description && <p className="ticket-queue-description">{ticket.description}</p>}
              {(ticket.materialtype || ticket.quantity || ticket.vendorname) && (
                <div className="ticket-queue-details">
                  <span><strong>Material:</strong> {ticket.materialtype || "—"}</span>
                  <span><strong>Quantity:</strong> {ticket.quantity ?? "—"}</span>
                  <span><strong>Preferred vendor:</strong> {ticket.vendorname || "—"}</span>
                </div>
              )}
              <div className="ticket-queue-action">
                <label htmlFor={`purchaser-${ticket.ticketid}`}>Assign Purchaser</label>
                <select
                  id={`purchaser-${ticket.ticketid}`}
                  value={assignments[ticket.ticketid] || ""}
                  onChange={(event) => setAssignments((current) => ({ ...current, [ticket.ticketid]: event.target.value }))}
                  disabled={submittingId === ticket.ticketid || purchasers.length === 0}
                >
                  <option value="">Select a Purchaser</option>
                  {purchasers.map((purchaser) => <option key={purchaser.userid} value={purchaser.userid}>{purchaser.name} ({purchaser.email})</option>)}
                </select>
                <Button type="button" disabled={!assignments[ticket.ticketid] || submittingId === ticket.ticketid} onClick={() => handleAcknowledge(ticket)}>
                  {submittingId === ticket.ticketid ? "Assigning…" : "Acknowledge & Assign"}
                </Button>
              </div>
              {purchasers.length === 0 && <p className="ticket-queue-warning">There are no active Purchasers available to assign.</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
