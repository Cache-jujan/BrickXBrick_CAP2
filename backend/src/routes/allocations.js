// allocations.js — F8 split-receipt allocation (no-bookkeeper design).
//
// The actor scans ONE receipt. The server splits each receipt line across the
// open Material Requests for that material, oldest request first, and saves
// one expense per request (UC-08-01 steps 6-8). Anything no open request
// covers blocks the submit (UC-06-01 E3: no request, no purchase).
//
// Actors: Purchaser (primary); Project Manager and General Manager are the
// UC-08-01 backup actors. Scope per role lives in lib/openRequests.js.
//
//   GET  /open-requests  the To-buy list
//   POST /trip-cost      a cost with no request (gas, toll): split evenly over ticked projects
//   POST /preview        run the split, write nothing
//   POST /               run the split and save it in one transaction. The client may send
//                        its own commonReceiptID: sending the same one again (a retry after
//                        a lost response) returns what was saved the first time.

const crypto = require("crypto");
const express = require("express");
const { withTransaction } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { receiptImageExists } = require("../lib/receiptStorage");
const { EXPENSE_COLUMNS, classifyBir, normalizeBirFields } = require("../lib/receiptFields");
const { screenExpense } = require("../lib/screenExpense");
const { assertLegalTransition, logTransition } = require("../lib/ticketTransitions");
const {
  httpError,
  formatMoney,
  validatePlanInput,
  validateAllocationBody,
  validateAllocationSum,
  validateCloseShortReason,
  parseMoneyCents,
  UUID_PATTERN,
} = require("../lib/allocationValidation");
const { REASONS, splitTripCost } = require("../lib/tripCostPlan");
const { planAllocation, presentPlan, submitNoteFor } = require("../lib/allocationPlan");
const { ALLOCATION_ROLES, loadOpenRequests, buildLockQuery, ticketScope } = require("../lib/openRequests");

const router = express.Router();
router.use(requireAuth);

// Screening runs after COMMIT. The expenses are already saved, so a screening
// failure must not turn into a 500: report it per expense instead of
// pretending the portion is clean.
async function screen(expenseID) {
  try {
    const { flagTypes } = await screenExpense(expenseID);
    return { flagTypes };
  } catch (error) {
    console.error(`Screening failed for expense ${expenseID}:`, error.message);
    return { flagTypes: null, error: error.message };
  }
}

// Peso / quantity strings for Postgres DECIMAL columns (no floats).
const qtyString = (quantityH) => formatMoney(quantityH); // same 2-decimal format
/** Convert an allocated line to stored units, deriving its unit price unless quantity is zero. */
const storedLine = (line) => ({
  description: line.description,
  quantity: line.quantityH / 100,
  amount: line.amountCents / 100,
  // Each portion is a pro-rata slice, so derive its unit price from the slice.
  unitPrice: line.quantityH > 0 ? Math.round((line.amountCents * 100) / line.quantityH) / 100 : null,
  bomItemID: line.bomItemID ?? null,
});

function planError(plan) {
  const shown = presentPlan(plan);
  return httpError(400, shown.problems.join(" "), {
    problems: shown.problems,
    uncovered: shown.uncovered,
    unmatched: shown.unmatched,
    portions: shown.portions,
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// What an earlier POST with this commonReceiptID saved, or null if nothing was.
// Only the same user's own expenses count, so an ID cannot be used to read another's.
async function loadSaved(client, commonReceiptID, userId) {
  const found = await client.query(
    `SELECT ${EXPENSE_COLUMNS}
       FROM expenses
      WHERE submittedby = $2
        AND expenseid IN (SELECT expenseid FROM receiptallocations WHERE commonreceiptid = $1)
      ORDER BY submittedat`,
    [commonReceiptID, userId]
  );
  if (found.rowCount === 0) return null;

  const expenses = found.rows;
  const tickets = await client.query(
    `SELECT ticketid, status FROM tickets WHERE ticketid = ANY($1::uuid[])`,
    [expenses.map((e) => e.ticketID)]
  );
  const flags = await client.query(
    `SELECT expenseid, flagtype FROM fraudflags WHERE expenseid = ANY($1::uuid[])`,
    [expenses.map((e) => e.expenseID)]
  );

  const screening = {};
  for (const expense of expenses) screening[expense.expenseID] = { flagTypes: [] };
  for (const flag of flags.rows) screening[flag.expenseid]?.flagTypes.push(flag.flagtype);

  return {
    commonReceiptID,
    expenses,
    resolvedTicketIDs: tickets.rows.filter((t) => t.status === "Resolved").map((t) => t.ticketid),
    stillOpenTicketIDs: tickets.rows.filter((t) => t.status !== "Resolved").map((t) => t.ticketid),
    warnings: [],
    screening,
    replayed: true,
  };
}

// GET /open-requests — open requests with remaining quantity, oldest first.
router.get("/open-requests", requireRole(...ALLOCATION_ROLES), async (req, res, next) => {
  try {
    res.json(await loadOpenRequests(req.user));
  } catch (error) {
    next(error);
  }
});

// POST /preview — the split the server WOULD save. Writes nothing.
router.post("/preview", requireRole(...ALLOCATION_ROLES), async (req, res, next) => {
  try {
    const input = validatePlanInput(req.body);
    const openTickets = await loadOpenRequests(req.user);
    const plan = planAllocation(input.lineItems, openTickets, {
      excludeTicketIDs: input.excludeTicketIDs,
      feeTargets: input.feeTargets,
      lineTargets: input.lineTargets,
    });
    res.json(presentPlan(plan));
  } catch (error) {
    next(error);
  }
});

// POST / — save the split.
router.post("/", requireRole(...ALLOCATION_ROLES), async (req, res, next) => {
  try {
    // 1. Shape of the body, and the receipt image must be one we stored.
    const body = validateAllocationBody(req.body);
    const clientReceiptID = req.body?.commonReceiptID == null ? null : String(req.body.commonReceiptID).toLowerCase();
    if (clientReceiptID && !UUID.test(clientReceiptID)) {
      throw httpError(400, "commonReceiptID must be a UUID");
    }
    if (!(await receiptImageExists(body.receiptImageURL))) {
      throw httpError(400, "receiptImageURL must reference a receipt uploaded via POST /api/receipts/scan");
    }

    // 2. Receipt lines must add up to the receipt total (UTC-003 / UTC-004).
    const sum = validateAllocationSum(body.lineItems, body.receiptTotal);
    if (!sum.valid) {
      const linesCents = body.lineItems.reduce((total, line) => total + line.amountCents, 0);
      throw httpError(400, sum.error, {
        linesTotal: formatMoney(linesCents),
        receiptTotal: formatMoney(body.receiptTotalCents),
        difference: formatMoney(Math.abs(linesCents - body.receiptTotalCents)),
      });
    }

    // 3. BIR fields: normalize (F9), then classify (F7) on the server.
    const bir = normalizeBirFields({ tin: body.tin, birPermitNumber: body.birPermitNumber, birNumber: body.birNumber });
    const { birValidationStatus } = classifyBir(bir);

    // 4. One transaction for every write. Any throw rolls everything back.
    const saved = await withTransaction(async (client) => {
      // 4a. Lock this actor's open requests, then read them with the same client.
      const lock = buildLockQuery(req.user);
      await client.query(lock.text, lock.params);

      // A retry of a request that already went through: answer with what was saved.
      if (clientReceiptID) {
        const earlier = await loadSaved(client, clientReceiptID, req.user.id);
        if (earlier) return earlier;
      }
      const openTickets = await loadOpenRequests(req.user, client);
      const statusByTicket = new Map(openTickets.map((row) => [row.ticketID, row.status]));

      // 4b. Plan. Not ok means nothing gets written.
      const plan = planAllocation(body.lineItems, openTickets, {
        excludeTicketIDs: body.excludeTicketIDs,
        feeTargets: body.feeTargets,
        lineTargets: body.lineTargets,
      });
      if (!plan.ok) throw planError(plan);

      const commonReceiptID = clientReceiptID ?? crypto.randomUUID();
      const expenses = [];
      const resolvedTicketIDs = [];
      const stillOpenTicketIDs = [];

      for (const portion of plan.portions) {
        // 4c. One expense per request. Each stores only its own lines, so
        // Layer 3 compares the request with exactly what was charged to it.
        const amount = formatMoney(portion.amountCents);
        const expenseResult = await client.query(
          `INSERT INTO expenses
             (projectid, submittedby, ticketid, vendorname, amount, receiptdate, category,
              birvalidationstatus, receiptimageurl, birnumber, tin, birpermitnumber,
              lineitems, quantity, submitnote)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING ${EXPENSE_COLUMNS}`,
          [
            portion.projectID,
            req.user.id,
            portion.ticketID,
            body.vendorName,
            amount,
            body.receiptDate,
            body.category,
            birValidationStatus,
            body.receiptImageURL,
            bir.birNumber,
            bir.tin,
            bir.birPermitNumber,
            JSON.stringify(portion.lines.map(storedLine)),
            qtyString(portion.quantityH),
            submitNoteFor(portion, body.note),
          ]
        );
        const expense = expenseResult.rows[0];

        await client.query(
          `INSERT INTO receiptallocations (expenseid, projectid, allocatedamount, commonreceiptid)
           VALUES ($1, $2, $3, $4)`,
          [expense.expenseID, portion.projectID, amount, commonReceiptID]
        );
        expenses.push(expense);

        // 4d. A request resolves only when this receipt brings it to 0.
        if (!portion.resolvesTicket) {
          stillOpenTicketIDs.push(portion.ticketID);
          continue;
        }
        // Already Resolved by the Purchaser (a Site Manager records the receipt afterwards).
        if (statusByTicket.get(portion.ticketID) === "Resolved") {
          resolvedTicketIDs.push(portion.ticketID);
          continue;
        }
        assertLegalTransition("Acknowledged", "Resolved");
        const update = await client.query(
          `UPDATE tickets
              SET status = 'Resolved', resolvedBy = $1, resolvedAt = NOW(), updatedAt = NOW()
            WHERE ticketId = $2 AND status = 'Acknowledged'
            RETURNING ticketid`,
          [req.user.id, portion.ticketID]
        );
        if (update.rowCount === 0) {
          throw httpError(409, `Ticket ${portion.ticketID} changed before this split was saved`);
        }
        await logTransition(client, {
          ticketId: portion.ticketID,
          fromStatus: "Acknowledged",
          toStatus: "Resolved",
          changedBy: req.user.id,
        });
        resolvedTicketIDs.push(portion.ticketID);
      }

      return { commonReceiptID, expenses, resolvedTicketIDs, stillOpenTicketIDs, warnings: presentPlan(plan).warnings };
    });

    if (saved.replayed) {
      return res.status(200).json(saved);
    }

    // 5. Screening runs AFTER COMMIT, once per portion. Inside the
    // transaction, screenExpense's own connection couldn't see these rows.
    const screening = {};
    for (const expense of saved.expenses) {
      screening[expense.expenseID] = await screen(expense.expenseID);
    }

    res.status(201).json({ ...saved, screening });
  } catch (error) {
    next(error);
  }
});

// POST /trip-cost — a cost with no request to match (gas, toll, delivery). The Purchaser
// ticks the projects the trip served and the receipt is split evenly between them: one
// ticketless expense per project, each approved by that project's Project Manager.
// Only projects where the caller has an open request can be charged.
router.post("/trip-cost", requireRole("Purchaser", "Site Manager"), async (req, res, next) => {
  try {
    const { receiptImageURL, vendorName, receiptDate, reason } = req.body ?? {};
    const clientReceiptID = req.body?.commonReceiptID == null ? null : String(req.body.commonReceiptID).toLowerCase();
    if (clientReceiptID && !UUID.test(clientReceiptID)) throw httpError(400, "commonReceiptID must be a UUID");
    if (typeof receiptImageURL !== "string" || !receiptImageURL.trim()) throw httpError(400, "receiptImageURL is required");
    if (typeof vendorName !== "string" || !vendorName.trim()) throw httpError(400, "vendorName is required");
    if (typeof receiptDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(receiptDate) || Number.isNaN(Date.parse(receiptDate))) {
      throw httpError(400, "receiptDate must be a valid YYYY-MM-DD date");
    }
    if (!REASONS.includes(reason)) throw httpError(400, `reason must be one of: ${REASONS.join(", ")}`);
    if (!Array.isArray(req.body?.projectIds) || req.body.projectIds.length === 0) {
      throw httpError(400, "Pick at least one project");
    }
    const projectIds = [...new Set(req.body.projectIds.map((id) => String(id).toLowerCase()))];
    if (projectIds.some((id) => !UUID_PATTERN.test(id))) throw httpError(400, "projectIds must be UUIDs");
    if (!(await receiptImageExists(receiptImageURL.trim()))) {
      throw httpError(400, "receiptImageURL must reference a receipt uploaded via POST /api/receipts/scan");
    }

    const totalCents = parseMoneyCents(req.body.receiptTotal, "receiptTotal");
    const bir = normalizeBirFields({ tin: req.body.tin, birPermitNumber: req.body.birPermitNumber, birNumber: req.body.birNumber });
    const { birValidationStatus } = classifyBir(bir);
    const extraNote = typeof req.body.note === "string" ? req.body.note.trim().slice(0, 300) : "";
    const submitNote = [`Trip cost: ${reason}.`, extraNote].filter(Boolean).join(" ");

    const saved = await withTransaction(async (client) => {
      if (clientReceiptID) {
        const earlier = await loadSaved(client, clientReceiptID, req.user.id);
        if (earlier) return earlier;
      }

      const open = await loadOpenRequests(req.user, client);
      const allowed = new Set(open.map((row) => String(row.projectID).toLowerCase()));
      const refused = projectIds.filter((id) => !allowed.has(id));
      if (refused.length > 0) {
        throw httpError(400, "A trip cost can only be charged to a project where you have an open request");
      }

      const commonReceiptID = clientReceiptID ?? crypto.randomUUID();
      const expenses = [];
      for (const portion of splitTripCost(totalCents, projectIds)) {
        const amount = formatMoney(portion.amountCents);
        const inserted = await client.query(
          `INSERT INTO expenses
             (projectid, submittedby, ticketid, vendorname, amount, receiptdate, category,
              birvalidationstatus, receiptimageurl, birnumber, tin, birpermitnumber,
              lineitems, quantity, submitnote)
           VALUES ($1, $2, NULL, $3, $4, $5, 'Other', $6, $7, $8, $9, $10, $11, 1, $12)
           RETURNING ${EXPENSE_COLUMNS}`,
          [
            portion.projectID,
            req.user.id,
            vendorName.trim(),
            amount,
            receiptDate,
            birValidationStatus,
            receiptImageURL.trim(),
            bir.birNumber,
            bir.tin,
            bir.birPermitNumber,
            JSON.stringify([{ description: `${reason} (trip cost)`, quantity: 1, amount: portion.amountCents / 100, unitPrice: portion.amountCents / 100 }]),
            submitNote,
          ]
        );
        await client.query(
          `INSERT INTO receiptallocations (expenseid, projectid, allocatedamount, commonreceiptid)
           VALUES ($1, $2, $3, $4)`,
          [inserted.rows[0].expenseID, portion.projectID, amount, commonReceiptID]
        );
        expenses.push(inserted.rows[0]);
      }
      return { commonReceiptID, expenses, resolvedTicketIDs: [], stillOpenTicketIDs: [], warnings: [] };
    });

    if (saved.replayed) return res.status(200).json(saved);

    const screening = {};
    for (const expense of saved.expenses) screening[expense.expenseID] = await screen(expense.expenseID);
    res.status(201).json({ ...saved, screening });
  } catch (error) {
    next(error);
  }
});

// POST /close-short/:ticketId — "that's all I could buy". The money ran out (or the store ran
// out), so the request is closed with what was bought so far and a reason the PM can read.
// Resolving goes through the same transition log as any other resolve, so the usual
// ticket notifications fire.
router.post("/close-short/:ticketId", requireRole(...ALLOCATION_ROLES), async (req, res, next) => {
  try {
    const ticketId = String(req.params.ticketId).toLowerCase();
    if (!UUID_PATTERN.test(ticketId)) throw httpError(400, "ticketId must be a UUID");
    if (req.user.role === "Site Manager") throw httpError(403, "Only the Purchaser can close a request short");
    const reason = validateCloseShortReason(req.body?.reason);

    await withTransaction(async (client) => {
      const scope = ticketScope(req.user);
      const found = await client.query(
        `SELECT t.ticketid
           FROM tickets t
           JOIN projects p ON p.projectid = t.projectid
          WHERE ${scope.clause}
            AND t.ticketid = $${scope.params.length + 1}
            AND t.tickettype = 'Material Request'
            AND t.status = 'Acknowledged'
            FOR UPDATE OF t`,
        [...scope.params, ticketId]
      );
      if (found.rowCount === 0) throw httpError(404, "That request is not open, or it is not yours");

      assertLegalTransition("Acknowledged", "Resolved");
      await client.query(
        `UPDATE tickets
            SET status = 'Resolved', resolvedBy = $1, resolvedAt = NOW(), updatedAt = NOW(),
                closedshortreason = $3
          WHERE ticketId = $2`,
        [req.user.id, ticketId, reason]
      );
      await logTransition(client, {
        ticketId,
        fromStatus: "Acknowledged",
        toStatus: "Resolved",
        changedBy: req.user.id,
      });
    });

    res.json({ ticketID: ticketId, status: "Resolved", closedShortReason: reason });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
