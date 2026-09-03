// tickets.js — F4 ticket status transitions (resolve/reject/acknowledge).

const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { assertLegalTransition } = require("../lib/ticketTransitions");

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

router.patch("/:id/resolve", async (req, res, next) => {
    try {
        const ticket = await getTicket(req.params.id);
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

router.patch("/:id/reject", async (req, res, next) => {
    try {
        const ticket = await getTicket(req.params.id);
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

router.patch("/:id/acknowledge", async (req, res, next) => {
    try {
        const ticket = await getTicket(req.params.id);
        assertLegalTransition(ticket.status, "Acknowledged");

        const result = await query(
            "UPDATE tickets SET status = 'Acknowledged', acknowledgedAt = NOW(), updatedAt = NOW() WHERE ticketId = $1 AND status = $2 RETURNING *",
            [req.params.id, ticket.status]
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