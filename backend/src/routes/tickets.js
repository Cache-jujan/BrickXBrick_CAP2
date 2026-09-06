// tickets.js — F4 ticket creation, acknowledgment, and status transitions.

const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { assertLegalTransition } = require("../lib/ticketTransitions");
const { VALID_TICKET_TYPES } = require("../lib/ticketRouting");

const router = express.Router();
router.use(requireAuth);

async function getTicket(ticketId) {
    const result = await query('SELECT * FROM tickets WHERE ticketId = $1', [ticketId]);
    if (result.rowCount === 0) {
        const err = new Error(`Ticket ${ticketId} not found`);
        err.status = 404;
        throw err;
    }
    return result.rows[0];
}

// POST / — Site Manager creates a ticket on their own assigned project.
// ticketType is a category label only; it does not determine a recipient.
router.post("/", requireRole("Site Manager"), async (req, res, next) => {
    try {
        const { projectID, ticketType, subject, description, photoURL } = req.body;

        if (!projectID || !ticketType || !subject) {
            const err = new Error("projectID, ticketType, and subject are required");
            err.status = 400;
            throw err;
        }

        if (!VALID_TICKET_TYPES.includes(ticketType)) {
            const err = new Error(`ticketType must be one of: ${VALID_TICKET_TYPES.join(", ")}`);
            err.status = 400;
            throw err;
        }

        const projectResult = await query(
            "SELECT projectId, status, siteManagerId FROM projects WHERE projectId = $1",
            [projectID]
        );
        if (projectResult.rowCount === 0) {
            const err = new Error(`Project ${projectID} not found`);
            err.status = 404;
            throw err;
        }
        const project = projectResult.rows[0];

        if (project.sitemanagerid !== req.user.id) {
            const err = new Error("You may only create tickets on the project you are assigned to");
            err.status = 403;
            throw err;
        }

        const result = await query(
            `INSERT INTO tickets
               (projectId, submittedBy, ticketType, subject, description, photoURL)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [projectID, req.user.id, ticketType, subject, description || null, photoURL || null]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// GET /assigned — tickets currently routed to the calling Purchaser.
// Pending tickets are naturally excluded: assignedTo is NULL until a PM
// acknowledges and assigns a Purchaser.
router.get("/assigned", async (req, res, next) => {
    try {
        const result = await query(
            "SELECT * FROM tickets WHERE assignedTo = $1 ORDER BY createdAt DESC",
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// GET /submitted — tickets created by the calling user (Site Manager view).
// No role gate: the WHERE filter already scopes results to the caller's own
// tickets, so a PM/Purchaser hitting this just gets an empty list.
router.get("/submitted", async (req, res, next) => {
    try {
        const result = await query(
            `SELECT t.*, u.role AS rejectedByRole
               FROM tickets t
               LEFT JOIN users u ON u.userId = t.resolvedBy
              WHERE t.submittedBy = $1
              ORDER BY t.createdAt DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// PATCH /:id/acknowledge — PM only, Pending -> Acknowledged.
// This is the point at which a specific Purchaser is assigned to the ticket.
router.patch("/:id/acknowledge", requireRole("Project Manager"), async (req, res, next) => {
    try {
        const { assignedTo } = req.body;

        if (!assignedTo) {
            const err = new Error("assignedTo (a Purchaser's userId) is required to acknowledge a ticket");
            err.status = 400;
            throw err;
        }

        const assigneeResult = await query(
            "SELECT userId, role, status FROM users WHERE userId = $1",
            [assignedTo]
        );
        if (assigneeResult.rowCount === 0) {
            const err = new Error(`Assigned user ${assignedTo} not found`);
            err.status = 404;
            throw err;
        }
        const assignee = assigneeResult.rows[0];
        if (assignee.status !== "Active") {
            const err = new Error(`Assigned user ${assignedTo} is not an active account`);
            err.status = 400;
            throw err;
        }
        if (assignee.role !== "Purchaser") {
            const err = new Error(`assignedTo must be a Purchaser, but user ${assignedTo} is a ${assignee.role}`);
            err.status = 400;
            throw err;
        }

        const ticket = await getTicket(req.params.id);
        assertLegalTransition(ticket.status, "Acknowledged");

        const result = await query(
            "UPDATE tickets SET status = 'Acknowledged', assignedTo = $1, acknowledgedAt = NOW(), updatedAt = NOW() WHERE ticketId = $2 AND status = $3 RETURNING *",
            [assignedTo, req.params.id, ticket.status]
        );

        if (result.rowCount === 0) {
            const err = new Error("Ticket status changed before this request was completed");
            err.status = 409;
            throw err;
        }

        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// PATCH /:id/resolve — assigned Purchaser only, Acknowledged -> Resolved.
router.patch("/:id/resolve", requireRole("Purchaser"), async (req, res, next) => {
    try {
        const ticket = await getTicket(req.params.id);

        if (ticket.assignedto !== req.user.id) {
            const err = new Error("Only the assigned Purchaser can resolve this ticket");
            err.status = 403;
            throw err;
        }

        assertLegalTransition(ticket.status, "Resolved");

        const result = await query(
            "UPDATE tickets SET status = 'Resolved', resolvedBy = $1, resolvedAt = NOW(), updatedAt = NOW() WHERE ticketId = $2 AND status = $3 RETURNING *",
            [req.user.id, req.params.id, ticket.status]
        );

        if (result.rowCount === 0) {
            const err = new Error("Ticket status changed before this request was completed");
            err.status = 409;
            throw err;
        }

        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// PATCH /:id/reject — PM (Pending only) or assigned Purchaser (Acknowledged only).
router.patch("/:id/reject", requireRole("Project Manager", "Purchaser"), async (req, res, next) => {
    try {
        const ticket = await getTicket(req.params.id);

        if (req.user.role === "Project Manager") {
            if (ticket.status !== "Pending") {
                const err = new Error("Project Manager may only reject a ticket while it is Pending");
                err.status = 409;
                throw err;
            }
        } else {
            // Purchaser
            if (ticket.assignedto !== req.user.id) {
                const err = new Error("Only the assigned Purchaser can reject this ticket");
                err.status = 403;
                throw err;
            }
            if (ticket.status !== "Acknowledged") {
                const err = new Error("Purchaser may only reject a ticket while it is Acknowledged");
                err.status = 409;
                throw err;
            }
        }

        assertLegalTransition(ticket.status, "Rejected");

        const result = await query(
            "UPDATE tickets SET status = 'Rejected', resolvedBy = $1, resolvedAt = NOW(), updatedAt = NOW() WHERE ticketId = $2 AND status = $3 RETURNING *",
            [req.user.id, req.params.id, ticket.status]
        );

        if (result.rowCount === 0) {
            const err = new Error("Ticket status changed before this request was completed");
            err.status = 409;
            throw err;
        }

        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

module.exports = router;