// ticketRouting.js — F4 ticket type constants.
// ticketType is a procurement category label only (Material Request vs Work
// Item) — it no longer determines who creates or receives a ticket. Routing
// is now handled by the acknowledge/resolve/reject workflow in routes/tickets.js.
//
// Report (F5) is the exception: SM's non-request issue reports, submitted
// via this same POST /api/tickets. Unlike Material Request/Work Item, a
// Report skips /acknowledge entirely — the PM resolves it directly from
// Pending. See the Report branch in routes/tickets.js.

const VALID_TICKET_TYPES = ["Material Request", "Work Item", "Report"];

module.exports = { VALID_TICKET_TYPES };