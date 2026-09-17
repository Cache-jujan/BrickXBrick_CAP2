// expenses.js — F6 expense submission + ticket linking.

const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { receiptImageExists } = require("../lib/receiptStorage");
const { EXPENSE_COLUMNS, classifyBir, normalizeLineItems } = require("../lib/receiptFields");

const router = express.Router();
router.use(requireAuth);

// Labor is intentionally excluded — the DB CHECK isn't built yet, so this is
// enforced here until that constraint lands.
const VALID_CATEGORIES = ["Materials", "Equipment", "Other"];

// Roles that may read any expense. Everyone else is scoped to their own.
const EXPENSE_READ_ALL_ROLES = ["General Manager", "Project Manager", "System Administrator"];

function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

// POST / — Purchaser submits an expense, optionally linked to a Resolved ticket.
router.post("/", requireRole("Purchaser"), async (req, res, next) => {
    try {
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
            quantity,
        } = req.body;

        // NOTE: birValidationStatus is deliberately NOT read from the body.
        // It decides what lands in the BIR tax-deductible report (F11), so a
        // client must not be able to declare its own receipt Formal. F7 is a
        // system-automated classification — it's derived below.

        if (!vendorName || amount === undefined || amount === null || !receiptDate) {
            throw badRequest("vendorName, amount, and receiptDate are required");
        }
        if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
            throw badRequest("amount must be a non-negative number");
        }
        if (!category || !VALID_CATEGORIES.includes(category)) {
            throw badRequest(`category must be one of: ${VALID_CATEGORIES.join(", ")}`);
        }
        if (quantity === undefined || quantity === null || typeof quantity !== "number" || quantity < 0) {
            throw badRequest("quantity is required and must be a non-negative number");
        }

        // receiptimageurl is NOT NULL, so confirm this is a receipt THIS
        // server stored via /receipts/scan. Without the check, any string
        // satisfies the column and the audit trail points at nothing.
        if (!receiptImageURL) {
            throw badRequest("receiptImageURL is required");
        }
        if (!(await receiptImageExists(receiptImageURL))) {
            throw badRequest("receiptImageURL must reference a receipt uploaded via POST /receipts/scan");
        }

        // lineItems is nullable at the DB level, but a malformed array
        // shouldn't silently write junk into the jsonb column.
        let storedLineItems = null;
        if (lineItems !== undefined && lineItems !== null) {
            if (!Array.isArray(lineItems)) {
                throw badRequest("lineItems must be an array of { description: string, amount: number }");
            }
            const normalized = normalizeLineItems(lineItems);
            if (normalized.length !== lineItems.length) {
                throw badRequest("lineItems must be an array of { description: string, amount: number }");
            }
            storedLineItems = normalized;
        }

        const { birValidationStatus } = classifyBir({ tin, birPermitNumber, birNumber });

        // projectID resolution: when a ticket is given, the ticket is the
        // source of truth for which project this belongs to — not the
        // client-supplied projectID. This is what stops Expenses.projectID
        // disagreeing with the linked ticket (F9 Layer 3).
        let projectID = bodyProjectID;

        if (ticketID) {
            const ticketResult = await query(
                "SELECT ticketid, projectid, status, assignedto FROM tickets WHERE ticketid = $1",
                [ticketID]
            );
            if (ticketResult.rowCount === 0) {
                const err = new Error(`Ticket ${ticketID} not found`);
                err.status = 404;
                throw err;
            }
            const ticket = ticketResult.rows[0];

            if (ticket.assignedto !== req.user.id) {
                const err = new Error("You may only submit an expense against a ticket assigned to you");
                err.status = 403;
                throw err;
            }
            if (ticket.status !== "Resolved") {
                const err = new Error("Ticket must be Resolved before an expense can be linked to it");
                err.status = 409;
                throw err;
            }

            projectID = ticket.projectid;
        }

        if (!projectID) {
            throw badRequest("projectID is required when no ticketID is provided");
        }

        const result = await query(
            `INSERT INTO expenses
               (projectid, submittedby, ticketid, vendorname, amount, receiptdate,
                category, birvalidationstatus, receiptimageurl, birnumber, tin,
                birpermitnumber, lineitems, quantity)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING ${EXPENSE_COLUMNS}`,
            [
                projectID,
                req.user.id,
                ticketID || null,
                vendorName,
                amount,
                receiptDate,
                category,
                birValidationStatus,
                receiptImageURL,
                birNumber || null,
                tin || null,
                birPermitNumber || null,
                storedLineItems ? JSON.stringify(storedLineItems) : null,
                quantity,
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// GET /mine — the caller's own submitted expenses.
router.get("/mine", requireRole("Purchaser"), async (req, res, next) => {
    try {
        const result = await query(
            `SELECT ${EXPENSE_COLUMNS} FROM expenses
             WHERE submittedby = $1 ORDER BY submittedat DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// GET /:id — single expense, scoped by role.
// The scope lives in the WHERE clause rather than a post-fetch check, so a
// user with no right to the row gets a plain 404 instead of a 403 that
// confirms the row exists.
router.get("/:id", async (req, res, next) => {
    try {
        const canReadAll = EXPENSE_READ_ALL_ROLES.includes(req.user.role);

        const result = await query(
            `SELECT ${EXPENSE_COLUMNS} FROM expenses
             WHERE expenseid = $1 AND ($2::boolean OR submittedby = $3)`,
            [req.params.id, canReadAll, req.user.id]
        );

        if (result.rowCount === 0) {
            const err = new Error("Not found");
            err.status = 404;
            throw err;
        }
        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

module.exports = router;