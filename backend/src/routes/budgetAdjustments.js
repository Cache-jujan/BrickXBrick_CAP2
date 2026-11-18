// budgetAdjustments.js: a Purchaser who is blocked by a request's approved budget asks the Project Manager to
// adjust it. The ask is a ticket (ticketType "Budget Adjustment") linked to the Material Request, so it appears in
// the PM's ticket queue. Pending -> Resolved (approved: the request's approved budget goes up) or Rejected (with a reason).
//
//   POST /            Purchaser: send one  { ticketID, requestedAmount, reasonCode, note? }
//   GET  /mine        Purchaser: their own adjustment tickets and how each was decided
//   POST /:id/approve Project Manager of that project
//   POST /:id/reject  Project Manager of that project  { reason }
const express = require("express");
const { query, withTransaction } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { notifySafely } = require("../lib/notify");
const { formatMoney } = require("../lib/allocationValidation");
const {
  UUID_RE,
  peso,
  validateAdjustmentBody,
  describeAdjustment,
  validateRejectionReason,
} = require("../lib/budgetAdjustment");

const router = express.Router();
router.use(requireAuth);

const httpError = (status, message) => Object.assign(new Error(message), { status });
const toCents = (value) => Math.round(Number(value) * 100);

async function logStatus(client, { ticketId, fromStatus, toStatus, changedBy }) {
  await client.query(
    `INSERT INTO ticket_status_transitions (ticketId, fromStatus, toStatus, changedBy) VALUES ($1, $2, $3, $4)`,
    [ticketId, fromStatus, toStatus, changedBy]
  );
}

// POST /api/budget-adjustments
router.post("/", requireRole("Purchaser"), async (req, res, next) => {
  try {
    const { ticketID, requestedCents, reasonCode, note } = validateAdjustmentBody(req.body);
    const created = await withTransaction(async (client) => {
      // The request must be one of this Purchaser's own, still being bought, with a budget to adjust.
      const found = await client.query(
        `SELECT t.ticketId, t.projectId, t.materialType, t.quantity, t.unit, t.approvedBudget, t.status, t.ticketType,
                t.assignedTo, p.name AS projectName, p.projectManagerId
           FROM tickets t JOIN projects p ON p.projectId = t.projectId
          WHERE t.ticketId = $1
          FOR UPDATE OF t`,
        [ticketID]
      );
      const parent = found.rows[0];
      if (!parent || parent.tickettype !== "Material Request" || String(parent.assignedto) !== String(req.user.id)) {
        throw httpError(404, "That request is not one of yours");
      }
      if (parent.status !== "Acknowledged") throw httpError(409, "That request is no longer open");
      if (parent.approvedbudget === null || parent.approvedbudget === undefined) {
        throw httpError(409, "That request has no approved budget yet. Ask the Project Manager to set one.");
      }
      const open = await client.query(
        `SELECT 1 FROM tickets WHERE parentTicketId = $1 AND ticketType = 'Budget Adjustment' AND status = 'Pending'`,
        [ticketID]
      );
      if (open.rowCount > 0) throw httpError(409, "You already sent a budget adjustment for this request. Wait for the Project Manager.");

      const description = describeAdjustment({
        materialType: parent.materialtype,
        projectName: parent.projectname,
        requestedCents,
        currentBudgetCents: toCents(parent.approvedbudget),
        reasonCode,
        note,
      });
      const subject = `Budget adjustment: ${parent.materialtype || "material request"}`.slice(0, 100);
      const inserted = await client.query(
        `INSERT INTO tickets (projectId, submittedBy, ticketType, subject, description, status,
                              materialType, quantity, unit, parentTicketId, requestedAmount, adjustmentReason)
         VALUES ($1, $2, 'Budget Adjustment', $3, $4, 'Pending', $5, $6, $7, $8, $9, $10)
         RETURNING ticketId`,
        [parent.projectid, req.user.id, subject, description, parent.materialtype, parent.quantity, parent.unit,
          ticketID, formatMoney(requestedCents), reasonCode]
      );
      const adjustmentId = inserted.rows[0].ticketid;
      await logStatus(client, { ticketId: adjustmentId, fromStatus: null, toStatus: "Pending", changedBy: req.user.id });
      await notifySafely(client, {
        recipientIds: [parent.projectmanagerid],
        excludeUserId: req.user.id,
        type: "TicketSubmitted",
        entityType: "Ticket",
        entityId: adjustmentId,
        message: `${req.user.name || "A Purchaser"} asked to raise the budget of ${parent.materialtype || "a request"} (${parent.projectname}) by ${peso(requestedCents)}.`,
      });
      return { ticketID: adjustmentId };
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// GET /api/budget-adjustments/mine
router.get("/mine", requireRole("Purchaser"), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT t.ticketId AS "ticketID", t.parentTicketId AS "parentTicketID", t.status,
              t.requestedAmount AS "requestedAmount", t.adjustmentReason AS "reasonCode",
              t.rejectionReason AS "rejectionReason", t.createdAt AS "createdAt", t.resolvedAt AS "resolvedAt"
         FROM tickets t
        WHERE t.ticketType = 'Budget Adjustment' AND t.submittedBy = $1
        ORDER BY t.createdAt DESC
        LIMIT 100`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Locks a Pending adjustment that belongs to one of this PM's projects.
async function lockPendingAdjustment(client, id, pmId) {
  if (!UUID_RE.test(id)) throw httpError(400, "That is not a valid ticket id");
  const found = await client.query(
    `SELECT t.ticketId, t.submittedBy, t.status, t.parentTicketId, t.requestedAmount, t.materialType, p.name AS projectName
       FROM tickets t JOIN projects p ON p.projectId = t.projectId
      WHERE t.ticketId = $1 AND t.ticketType = 'Budget Adjustment' AND p.projectManagerId = $2
      FOR UPDATE OF t`,
    [id, pmId]
  );
  const ticket = found.rows[0];
  if (!ticket) throw httpError(404, "Budget adjustment not found");
  if (ticket.status !== "Pending") throw httpError(409, `This ticket is already ${ticket.status.toLowerCase()}`);
  return ticket;
}

// POST /api/budget-adjustments/:id/approve
router.post("/:id/approve", requireRole("Project Manager"), async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const ticket = await lockPendingAdjustment(client, req.params.id, req.user.id);
      const parent = await client.query(
        `SELECT approvedBudget FROM tickets WHERE ticketId = $1 AND ticketType = 'Material Request' FOR UPDATE`,
        [ticket.parentticketid]
      );
      if (parent.rowCount === 0) throw httpError(409, "The request this ticket was about no longer exists");
      const previous = parent.rows[0].approvedbudget;
      const next = (toCents(previous ?? 0) + toCents(ticket.requestedamount)) / 100;
      await client.query(`UPDATE tickets SET approvedBudget = $2, updatedAt = NOW() WHERE ticketId = $1`, [ticket.parentticketid, next.toFixed(2)]);
      await client.query(
        `UPDATE tickets SET status = 'Resolved', resolvedBy = $2, resolvedAt = NOW(), updatedAt = NOW(),
                            previousBudget = $3, newBudget = $4
          WHERE ticketId = $1`,
        [ticket.ticketid, req.user.id, previous, next.toFixed(2)]
      );
      await logStatus(client, { ticketId: ticket.ticketid, fromStatus: "Pending", toStatus: "Resolved", changedBy: req.user.id });
      await notifySafely(client, {
        recipientIds: [ticket.submittedby],
        excludeUserId: req.user.id,
        type: "TicketResolved",
        entityType: "Ticket",
        entityId: ticket.ticketid,
        message: `Budget adjustment approved: ${ticket.materialtype || "your request"} (${ticket.projectname}) now has ${peso(toCents(next))} to spend. You can buy it now.`,
      });
      return { ticketID: ticket.ticketid, status: "Resolved", newBudget: next.toFixed(2) };
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/budget-adjustments/:id/reject  { reason }
router.post("/:id/reject", requireRole("Project Manager"), async (req, res, next) => {
  try {
    const reason = validateRejectionReason(req.body?.reason);
    const result = await withTransaction(async (client) => {
      const ticket = await lockPendingAdjustment(client, req.params.id, req.user.id);
      await client.query(
        `UPDATE tickets SET status = 'Rejected', resolvedBy = $2, resolvedAt = NOW(), updatedAt = NOW(), rejectionReason = $3
          WHERE ticketId = $1`,
        [ticket.ticketid, req.user.id, reason]
      );
      await logStatus(client, { ticketId: ticket.ticketid, fromStatus: "Pending", toStatus: "Rejected", changedBy: req.user.id });
      await notifySafely(client, {
        recipientIds: [ticket.submittedby],
        excludeUserId: req.user.id,
        type: "TicketRejected",
        entityType: "Ticket",
        entityId: ticket.ticketid,
        message: `Budget adjustment rejected for ${ticket.materialtype || "your request"} (${ticket.projectname}): ${reason}`,
      });
      return { ticketID: ticket.ticketid, status: "Rejected" };
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
