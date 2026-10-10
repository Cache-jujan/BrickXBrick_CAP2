// sync.js — F10 Offline Operation & Data Synchronization.
//
// The mobile app queues actions taken while offline (in local SQLite) and,
// on reconnect, POSTs them here as a batch. This endpoint replays each queued
// action against the real server logic, so an offline submission is treated
// exactly like an online one — it is just a delivery delay, never a way to
// bypass F9 fraud screening.
//
// Idempotency: every queued item carries a client-generated `uuid`. We record
// processed UUIDs in synced_actions, so a batch re-sent after a flaky reconnect
// cannot create the same expense twice.
//
// Per-item isolation: one bad item never blocks the good ones. The response is
//   { syncedIds: [...], rejected: [ { id, code, message } ] }
// matching the shape the mobile client expects.

const express = require("express");
const { query, withTransaction } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { receiptImageExists } = require("../lib/receiptStorage");
const {
  classifyBir,
  normalizeBirFields,
  normalizeLineItems,
  computeQuantityFromLineItems,
} = require("../lib/receiptFields");
const { screenExpense } = require("../lib/screenExpense");

const router = express.Router();
router.use(requireAuth);

const VALID_CATEGORIES = ["Materials", "Equipment", "Other"];

// A rejection the client should NOT retry (business/validation failure).
// Network errors never reach here — those fail the whole HTTP call and the
// client keeps the items PENDING_SYNC for automatic retry.
class SyncReject extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Process ONE queued expense. Returns the new expenseID, or throws SyncReject.
// Mirrors POST /api/expenses: validate -> normalize -> insert -> screen.
async function syncExpense(user, uuid, data) {
  const {
    ticketID,
    projectID: bodyProjectID,
    vendorName,
    amount,
    receiptDate,
    category,
    receiptImageURL,
    birNumber,
    tin,
    birPermitNumber,
    lineItems,
  } = data || {};

  if (!vendorName || amount === undefined || amount === null || !receiptDate) {
    throw new SyncReject("INVALID_FIELDS", "vendorName, amount, and receiptDate are required");
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    throw new SyncReject("INVALID_AMOUNT", "amount must be a non-negative number");
  }
  if (!category || !VALID_CATEGORIES.includes(category)) {
    throw new SyncReject("INVALID_CATEGORY", `category must be one of: ${VALID_CATEGORIES.join(", ")}`);
  }
  if (!receiptImageURL) {
    throw new SyncReject("MISSING_RECEIPT", "receiptImageURL is required");
  }
  // The mobile app must upload the receipt image on reconnect BEFORE syncing,
  // so this URL points at a receipt this server stored.
  if (!(await receiptImageExists(receiptImageURL))) {
    throw new SyncReject("MISSING_RECEIPT", "receiptImageURL must reference a receipt uploaded via POST /receipts/scan");
  }
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new SyncReject("INVALID_LINE_ITEMS", "lineItems must include at least one item");
  }
  const storedLineItems = normalizeLineItems(lineItems);
  if (storedLineItems.length === 0) {
    throw new SyncReject("INVALID_LINE_ITEMS", "lineItems must be an array of { description, amount }");
  }
  const quantity = computeQuantityFromLineItems(storedLineItems);

  const bir = normalizeBirFields({ tin, birPermitNumber, birNumber });
  const { birValidationStatus } = classifyBir(bir);

  // When a ticket is given, it is the source of truth for the project.
  let projectID = bodyProjectID;
  if (ticketID) {
    const ticketResult = await query(
      "SELECT projectid, status, assignedto FROM tickets WHERE ticketid = $1",
      [ticketID]
    );
    if (ticketResult.rowCount === 0) {
      throw new SyncReject("TICKET_NOT_FOUND", `Ticket ${ticketID} not found`);
    }
    const ticket = ticketResult.rows[0];
    if (ticket.assignedto !== user.id) {
      throw new SyncReject("TICKET_NOT_YOURS", "You may only submit an expense against a ticket assigned to you");
    }
    if (ticket.status !== "Resolved") {
      throw new SyncReject("TICKET_NOT_RESOLVED", "Ticket must be Resolved before an expense can be linked to it");
    }
    projectID = ticket.projectid;
  }
  if (!projectID) {
    throw new SyncReject("MISSING_PROJECT", "projectID is required when no ticketID is provided");
  }

  // Insert the expense and record the idempotency key in ONE transaction, so a
  // crash can't leave an expense without its synced_actions marker (or vice
  // versa). Screening runs AFTER commit (it reads through the pool).
  const expenseID = await withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO expenses
         (projectid, submittedby, ticketid, vendorname, amount, receiptdate,
          category, birvalidationstatus, receiptimageurl, birnumber, tin,
          birpermitnumber, lineitems, quantity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING expenseid`,
      [
        projectID, user.id, ticketID || null, vendorName, amount, receiptDate,
        category, birValidationStatus, receiptImageURL, bir.birNumber, bir.tin,
        bir.birPermitNumber, JSON.stringify(storedLineItems), quantity,
      ]
    );
    const newId = result.rows[0].expenseid;
    await client.query(
      `INSERT INTO synced_actions (action_uuid, user_id, action_type, expense_id)
       VALUES ($1, $2, 'expense', $3)`,
      [uuid, user.id, newId]
    );
    return newId;
  });

  await screenExpense(expenseID);
  return expenseID;
}

// POST /api/sync — batch of queued offline actions.
// Body: { items: [ { uuid, type: "expense", data: {...} }, ... ] }
router.post("/", requireRole("Purchaser"), async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items must be a non-empty array" });
    }

    const syncedIds = [];
    const rejected = [];

    for (const item of items) {
      const uuid = item && item.uuid;
      if (!uuid) {
        rejected.push({ id: null, code: "MISSING_UUID", message: "each item needs a uuid" });
        continue;
      }

      try {
        // Idempotency: already processed this uuid? Report it synced, do nothing.
        const seen = await query(
          "SELECT action_uuid FROM synced_actions WHERE action_uuid = $1",
          [uuid]
        );
        if (seen.rowCount > 0) {
          syncedIds.push(uuid);
          continue;
        }

        const type = item.type || "expense";
        if (type !== "expense") {
          throw new SyncReject("UNSUPPORTED_TYPE", `action type '${type}' is not supported yet`);
        }

        await syncExpense(req.user, uuid, item.data);
        syncedIds.push(uuid);
      } catch (err) {
        if (err instanceof SyncReject) {
          rejected.push({ id: uuid, code: err.code, message: err.message });
        } else {
          // Unexpected server error on THIS item — isolate it, keep going.
          console.error("SYNC ITEM ERROR:", uuid, err);
          rejected.push({ id: uuid, code: "SERVER_ERROR", message: "could not sync this item" });
        }
      }
    }

    res.status(200).json({ syncedIds, rejected });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
