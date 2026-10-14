const { notifyTicketTransition } = require("./notify");

// ticketTransitions.js — F4 ticket-status state machine.
// Pending is the only starting state; Resolved/Rejected are terminal.
//
// Pending -> Acknowledged or Rejected
// Acknowledged -> Resolved or Rejected
//
// Note: this table only enforces which STATES a transition may occur between.
// It does not know WHO is making the transition. routes/tickets.js applies
// additional role-based preconditions on top of this (e.g. a PM may only
// reject from Pending, never from Acknowledged) — see the /reject handler.

const ALLOWED_TRANSITIONS = {
    Pending: ["Acknowledged", "Rejected"],
    Acknowledged: ["Resolved", "Rejected"],
    Resolved: [],
    Rejected: []
};

function assertLegalTransition(currentStatus, targetStatus) {
    const allowed = ALLOWED_TRANSITIONS[currentStatus];
    if (!allowed.includes(targetStatus)) {
        const err = new Error(`Cannot move ticket from ${currentStatus} to ${targetStatus}`);
        err.status = 409;
        err.details = {currentStatus, attemptedStatus: targetStatus};
        throw err;
    }
}

// Writes one ticket_status_transitions row. Takes the transaction's client so
// the log row commits or rolls back together with the status change.
// Shared by routes/tickets.js and routes/allocations.js (F8).
//
// Side effect: a status change to Acknowledged / Resolved / Rejected also
// writes the matching notifications (same client, same transaction). Putting
// this here means every path that moves a ticket notifies the right people
// with no per-route wiring — the F8 allocation resolve included. The initial
// Pending transition produces no notification; the create path handles the
// "new request" notice (it knows about batching). Never notifies the actor.
async function logTransition(client, { ticketId, fromStatus, toStatus, changedBy }) {
    await client.query(
        `INSERT INTO ticket_status_transitions (ticketId, fromStatus, toStatus, changedBy)
         VALUES ($1, $2, $3, $4)`,
        [ticketId, fromStatus, toStatus, changedBy]
    );
    await notifyTicketTransition(client, { ticketId, toStatus, changedBy });
}

module.exports = { assertLegalTransition, logTransition, ALLOWED_TRANSITIONS};