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
//   POST /preview        run the split, write nothing
//   POST /               run the split and save it in one transaction

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
} = require("../lib/allocationValidation");
const { planAllocation, presentPlan } = require("../lib/allocationPlan");
const { ALLOCATION_ROLES, loadOpenRequests, buildLockQuery } = require("../lib/openRequests");

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
const storedLine = (line) => ({
  description: line.description,
  quantity: line.quantityH / 100,
  amount: line.amountCents / 100,
  unitPrice: null,
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
      const openTickets = await loadOpenRequests(req.user, client);

      // 4b. Plan. Not ok means nothing gets written.
      const plan = planAllocation(body.lineItems, openTickets, {
        excludeTicketIDs: body.excludeTicketIDs,
        feeTargets: body.feeTargets,
      });
      if (!plan.ok) throw planError(plan);

      const commonReceiptID = crypto.randomUUID();
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
              lineitems, quantity)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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

module.exports = router;
