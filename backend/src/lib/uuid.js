// uuid.js — ONE UUID shape check, shared by every place that accepts an id
// from a client.
//
// Why this file exists: receipt line items are free-form JSON (lineitems is
// jsonb, the client builds the objects). A line arriving with
// bomItemID: "' OR 1=1" or bomItemID: 42 must not be stored. Each rebuild
// point validates the shape and stores null when it doesn't match, rather
// than trusting what the phone sent.
//
// This checks the SHAPE only. It does NOT check that the row exists — the
// foreign key on tickets.bomitemid does that, and receipt lines carry the id
// in jsonb where no FK can reach. A well-formed id for a deleted BOM item
// simply fails to match in F9 Layer 3, which is the safe direction.
//
// Why the loose pattern (any hex) rather than strict RFC-4122: bom.js and
// receipts.js already validate ids this way, and bom.js is what accepts a
// BOM item id in the first place. An id bom.js accepted must not be
// rejected here, or it could live on a ticket but never reach a receipt
// line. allocationValidation.js has its own STRICTER UUID_PATTERN for
// projectID and friends; that is left alone on purpose.
// TODO (follow-up, not this PR): the backend has three UUID regexes that
// disagree. Collapse them onto this one.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(value) {
  return typeof value === "string" && UUID.test(value);
}

// Returns the id when it is a well-formed UUID, otherwise null. Use this at
// every point that rebuilds a client-supplied line item.
function asUUIDOrNull(value) {
  return isUUID(value) ? value : null;
}

module.exports = { UUID, isUUID, asUUIDOrNull };