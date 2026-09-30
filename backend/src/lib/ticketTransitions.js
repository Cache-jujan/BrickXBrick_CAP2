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

module.exports = { assertLegalTransition, ALLOWED_TRANSITIONS};