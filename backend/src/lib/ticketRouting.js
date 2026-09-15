// ticketRouting.js — F4 ticket type constants.
// ticketType is a procurement category label only (Material Request vs Work
// Item) — it no longer determines who creates or receives a ticket. Routing
// is now handled by the acknowledge/resolve/reject workflow in routes/tickets.js.

const VALID_TICKET_TYPES = ["Material Request", "Work Item"];

module.exports = { VALID_TICKET_TYPES };