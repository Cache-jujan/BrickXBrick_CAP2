// sync.js — F10 Offline Operation & Data Synchronization.
//
// The mobile app queues actions taken while offline (in local SQLite) and,
// on reconnect, POSTs them here as a batch. This endpoint replays each queued
// action against the real server logic, so an offline submission is treated
// exactly like an online one — it is just a delivery delay, never a way to
// bypass F9 fraud screening.
//
// Idempotency: every queued item carries a client-generated `uuid`. An expense
// is recorded in synced_actions; a task update uses task_progress_log's own
// UNIQUE clientSubmissionId (the uuid). A batch re-sent after a flaky reconnect
// therefore cannot create the same record twice.
//
// Per-item isolation: one bad item never blocks the good ones. The response is
//   { syncedIds: [...], rejected: [ { id, code, message } ] }
// matching the shape the mobile client expects.

const express = require("express");
const { query, withTransaction } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { receiptImageExists } = require("../lib/receiptStorage");
const {
  classifyBir,
  normalizeBirFields,
  normalizeLineItems,
  computeQuantityFromLineItems,
} = require("../lib/receiptFields");
const { isTicketFulfilled, FULFILLED_MESSAGE } = require("../lib/ticketAvailability");
const { screenExpense } = require("../lib/screenExpense");
const { submitTaskProgress, taskPhotoExists, TaskProgressError } = require("../lib/taskProgress");

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

// The storage check (is the photo really there?) could not run: a timeout or a
// network problem, NOT a missing file. The item is left out of the response, so
// the phone keeps it pending and retries on the next sync.
class SyncRetry extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One queue, two kinds of items, each owned by one role.
const ROLE_FOR_TYPE = { expense: "Purchaser", task_update: "Site Manager" };

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
    let receiptExists;
  try {
    receiptExists = await receiptImageExists(receiptImageURL);
  } catch (error) {
    // R2 could not be reached: not the same as "missing". Keep the item pending.
    throw new SyncRetry(`could not check the receipt: ${error.message}`);
  }
  if (!receiptExists) {
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
  let resolveTicketInTransaction = false;
  if (ticketID) {
    const ticketResult = await query(
      "SELECT projectid, status, assignedto, quantity FROM tickets WHERE ticketid = $1",
      [ticketID]
    );
    if (ticketResult.rowCount === 0) {
      throw new SyncReject("TICKET_NOT_FOUND", `Ticket ${ticketID} not found`);
    }
    const ticket = ticketResult.rows[0];
    if (ticket.assignedto !== user.id) {
      throw new SyncReject("TICKET_NOT_YOURS", "You may only submit an expense against a ticket assigned to you");
    }
    // Only a request that is still being bought can take an expense: not one the
    // Site Manager withdrew or the PM rejected, and not one already filled.
    if (ticket.status !== "Acknowledged" && ticket.status !== "Resolved") {
      throw new SyncReject("TICKET_NOT_OPEN", `Ticket is ${ticket.status}; expenses can only be recorded against an Acknowledged ticket`);
    }
    if (await isTicketFulfilled(query, ticketID, ticket.quantity)) {
      throw new SyncReject("TICKET_FULFILLED", FULFILLED_MESSAGE);
    }
    // Auto-resolve: the online path calls resolveTicket before submitting, but
    // offline queues skip that step, so the sync endpoint does it. It runs in
    // the same transaction as the expense insert (below): a failed insert must
    // not leave the ticket Resolved with no expense.
    resolveTicketInTransaction = ticket.status !== "Resolved";
    projectID = ticket.projectid;
  }
  if (!projectID) {
    throw new SyncReject("MISSING_PROJECT", "projectID is required when no ticketID is provided");
  }
  const projectStatus = await query("SELECT status FROM projects WHERE projectid = $1", [projectID]);
  if (projectStatus.rowCount === 0) {
    throw new SyncReject("PROJECT_NOT_FOUND", `Project ${projectID} not found`);
  }
  if (projectStatus.rows[0].status !== "Active") {
    // Server wins: the project closed (or never opened) while this was queued.
    throw new SyncReject("PROJECT_NOT_ACTIVE", `This project is ${projectStatus.rows[0].status}; expenses can only be recorded on an Active project`);
  }

  // Insert the expense and record the idempotency key in ONE transaction, so a
  // crash can't leave an expense without its synced_actions marker (or vice
  // versa). Screening runs AFTER commit (it reads through the pool).
  const expenseID = await withTransaction(async (client) => {
    if (resolveTicketInTransaction) {
      await client.query(
        "UPDATE tickets SET status = 'Resolved' WHERE ticketid = $1 AND status != 'Resolved'",
        [ticketID]
      );
    }
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

// Why a shared-function failure is rejected, in the sync vocabulary.
const TASK_REJECT_CODE = {
  TASK_NOT_FOUND: "TASK_NOT_FOUND",
  TASK_NOT_YOURS: "TASK_NOT_YOURS",
  TASK_CLOSED: "TASK_CLOSED",
  SUPERSEDED: "SUPERSEDED",
  AWAITING_REVIEW: "SUPERSEDED", // a submission is already waiting for review
  CLIENT_ID_IN_USE: "DUPLICATE_UUID",
};

// Process ONE queued task submission (F10 item 10.4). `uuid` is the
// clientSubmissionId, so replaying the same item is the existing idempotency
// of task_progress_log: the second call finds the first row and reports synced.
// data = { taskId, photoUrl, note? }; the photo was uploaded first through
// POST /api/tasks/:id/photo.
// Returns nothing; throws SyncReject (never retried) or SyncRetry (retried).
async function syncTaskUpdate(user, uuid, data) {
  const { taskId, photoUrl, note } = data || {};

  if (!UUID_RE.test(String(uuid))) {
    throw new SyncReject("INVALID_FIELDS", "uuid must be a UUID");
  }
  if (typeof taskId !== "string" || !UUID_RE.test(taskId)) {
    throw new SyncReject("TASK_NOT_FOUND", "taskId must be the id of a task");
  }
  if (typeof photoUrl !== "string" || photoUrl.trim() === "") {
    throw new SyncReject("MISSING_PHOTO", "photoUrl is required to submit task completion");
  }
  if (note !== undefined && note !== null && typeof note !== "string") {
    throw new SyncReject("INVALID_FIELDS", "note must be text");
  }

  try {
    await submitTaskProgress({
      user,
      taskId,
      clientSubmissionId: uuid,
      note,
      photoUrl,
      // Rules the online route does not have: server wins if the project is no
      // longer Active, and the photo must be one this server stored for this task.
      beforeWrite: async (task) => {
        const project = await query(
          `SELECT p.status
             FROM milestones m
             JOIN projects p ON p.projectid = m.projectid
            WHERE m.milestoneid = $1`,
          [task.milestoneid]
        );
        const status = project.rows[0] && project.rows[0].status;
        if (status !== "Active") {
          throw new SyncReject("PROJECT_NOT_ACTIVE", `This project is ${status || "unavailable"}; task updates can only be recorded on an Active project`);
        }

        let exists;
        try {
          exists = await taskPhotoExists(photoUrl, taskId);
        } catch (error) {
          throw new SyncRetry(`could not check the photo: ${error.message}`);
        }
        if (!exists) {
          throw new SyncReject("MISSING_PHOTO", "photoUrl must reference a photo uploaded via POST /api/tasks/:id/photo for this task");
        }
      },
    });
  } catch (error) {
    if (error instanceof TaskProgressError) {
      throw new SyncReject(TASK_REJECT_CODE[error.code] || "SERVER_ERROR", error.message);
    }
    throw error;
  }
}

// POST /api/sync — batch of queued offline actions.
// Body: { items: [ { uuid, type: "expense" | "task_update", data: {...} }, ... ] }
// Any signed-in user may call it; each item is checked against ITS OWN role
// (expense: Purchaser, task_update: Site Manager), so one wrong item never
// blocks the good ones.
router.post("/", async (req, res, next) => {
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
        const type = item.type || "expense";
        if (!ROLE_FOR_TYPE[type]) {
          throw new SyncReject("UNSUPPORTED_TYPE", `action type '${type}' is not supported yet`);
        }
        if (req.user.role !== ROLE_FOR_TYPE[type]) {
          throw new SyncReject("WRONG_ROLE", `a ${type} can only be synced by a ${ROLE_FOR_TYPE[type]}`);
        }

        // Idempotency: already processed this uuid? Report it synced, do nothing.
        const seen = await query(
          "SELECT action_uuid FROM synced_actions WHERE action_uuid = $1",
          [uuid]
        );
        if (seen.rowCount > 0) {
          syncedIds.push(uuid);
          continue;
        }

        if (type === "expense") await syncExpense(req.user, uuid, item.data);
        else await syncTaskUpdate(req.user, uuid, item.data);
        syncedIds.push(uuid);
      } catch (err) {
        if (err instanceof SyncRetry) {
          // Not synced, not rejected: the phone keeps it pending and tries again.
          console.warn("SYNC ITEM RETRY LATER:", uuid, err.message);
        } else if (err instanceof SyncReject) {
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
