// ticketTransitions.js — F4 ticket-status state machine.
// Pending is the only starting state; Resolved/Rejected are terminal.
// Any other transition is rejected with a 409 (see server.js error middleware).

const ALLOWED_TRANSITIONS = {
    Pending: ["Acknowledged", "Resolved", "Rejected"],
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