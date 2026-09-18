// expenses.js — F6 expense submission + ticket linking.
// Table 35 (Expenses) already exists in 001_initial_schema.sql — no migration
// needed. This route just exposes it.

const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { canonicalizeExpense, submitHashWithTimeout } = require("../lib/blockchainService");
const { checkDuplicate } = require("../lib/fraudScreening");

const router = express.Router();
router.use(requireAuth);

// Labor is intentionally excluded — schema comment notes the DB CHECK isn't
// built yet, so this is enforced here until that constraint lands.
const VALID_CATEGORIES = ["Materials", "Equipment", "Other"];
const VALID_BIR_STATUSES = ["Formal-Tax-Deductible", "Informal"];

// lineItems shape matches the offlineExpenseQueue SQLite definition
// (Table 27): [{ description: string, amount: number }]
function isValidLineItems(lineItems) {
    if (!Array.isArray(lineItems)) return false;
    return lineItems.every(
        (item) =>
            item &&
            typeof item.description === "string" &&
            item.description.trim().length > 0 &&
            typeof item.amount === "number" &&
            item.amount >= 0
    );
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
            birValidationStatus,
            receiptImageURL,
            birNumber,
            tin,
            birPermitNumber,
            lineItems,
            quantity,
        } = req.body;

        if (!vendorName || amount === undefined || amount === null || !receiptDate) {
            const err = new Error("vendorName, amount, and receiptDate are required");
            err.status = 400;
            throw err;
        }
        if (typeof amount !== "number" || amount < 0) {
            const err = new Error("amount must be a non-negative number");
            err.status = 400;
            throw err;
        }
        if (!category || !VALID_CATEGORIES.includes(category)) {
            const err = new Error(`category must be one of: ${VALID_CATEGORIES.join(", ")}`);
            err.status = 400;
            throw err;
        }
        if (!birValidationStatus || !VALID_BIR_STATUSES.includes(birValidationStatus)) {
            const err = new Error(`birValidationStatus must be one of: ${VALID_BIR_STATUSES.join(", ")}`);
            err.status = 400;
            throw err;
        }
        if (!receiptImageURL) {
            const err = new Error("receiptImageURL is required");
            err.status = 400;
            throw err;
        }
        if (quantity === undefined || quantity === null || typeof quantity !== "number" || quantity < 0) {
            const err = new Error("quantity is required and must be a non-negative number");
            err.status = 400;
            throw err;
        }
        // lineItems is nullable at the DB level, but if it's present it must
        // be well-formed — a malformed array shouldn't silently write junk.
        if (lineItems !== undefined && lineItems !== null && !isValidLineItems(lineItems)) {
            const err = new Error("lineItems must be an array of { description: string, amount: number }");
            err.status = 400;
            throw err;
        }

        // projectID resolution: if a ticket is given, the ticket is the
        // source of truth for which project this belongs to — not the
        // client-supplied projectID. This is what stops a Ticket_Mismatch
        // situation (Expenses.projectID disagreeing with the linked ticket).
        let projectID = bodyProjectID;

        if (ticketID) {
            const ticketResult = await query(
                "SELECT ticketId, projectId, status, assignedTo FROM tickets WHERE ticketId = $1",
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
            const err = new Error("projectID is required when no ticketID is provided");
            err.status = 400;
            throw err;
        }

        const result = await query(
            `INSERT INTO Expenses
               (projectID, submittedBy, ticketID, vendorName, amount, receiptDate,
                category, birValidationStatus, receiptImageURL, birNumber, tin,
                birPermitNumber, lineItems, quantity)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING *`,
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
                lineItems ? JSON.stringify(lineItems) : null,
                quantity,
            ]
        );

        const expense = result.rows[0];

        const isDup = await checkDuplicate(expense);
        if (isDup) {
            
            await query(
                `INSERT INTO FraudFlags (expenseID, flaggedBy, flagType, reason)
                 VALUES ($1, 'system', 'BIR_Duplicate', $2)`,
                [expense.expenseid, "Duplicate: same TIN, BIR permit number, and BIR number as an existing expense"]
            );
        }

        res.status(201).json(expense);
    } catch (err) {
        next(err);
    }
});

// GET /mine — Purchaser's own submitted expenses.
router.get("/mine", requireRole("Purchaser"), async (req, res, next) => {
    try {
        const result = await query(
            "SELECT * FROM Expenses WHERE submittedBy = $1 ORDER BY submittedAt DESC",
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// GET /:id — role-scoped: Purchaser sees only their own submissions,
// GM/PM can see any expense (they need this for review/approval/reporting).
router.get("/:id", async (req, res, next) => {
    try {
        const result = await query("SELECT * FROM Expenses WHERE expenseID = $1", [req.params.id]);
        if (result.rowCount === 0) {
            const err = new Error("Not found");
            err.status = 404;
            throw err;
        }
        const expense = result.rows[0];

        const isOwner = expense.submittedby === req.user.id;
        const isReviewer = ["Project Manager", "General Manager"].includes(req.user.role);

        if (!isOwner && !isReviewer) {
            const err = new Error("You do not have access to this expense record");
            err.status = 403;
            throw err;
        }

        res.json(expense);
    } catch (err) {
        next(err);
    }
});

// PATCH /:id/approve — PM/GM only. Marks Approved, then submits SHA-256
// hash to the Geth PoA cluster and persists the confirmed tx to
// BlockchainLogs. If nodes are insufficient, blockchainStatus stays
// "Pending" so a scheduled retry (see server.js) can pick it up later.
router.patch("/:id/approve", requireRole("Project Manager", "General Manager"), async (req, res, next) => {
    try {
        const result = await query("SELECT * FROM Expenses WHERE expenseID = $1", [req.params.id]);
        if (result.rowCount === 0) {
            const err = new Error("Expense not found");
            err.status = 404;
            throw err;
        }
        const expense = result.rows[0];
        if (expense.status === "Approved") {
            const err = new Error("Expense is already approved");
            err.status = 409;
            throw err;
        }

        await query(
            "UPDATE Expenses SET status = 'Approved', approvedBy = $1 WHERE expenseID = $2",
            [req.user.id, req.params.id]
        );

        const hash = canonicalizeExpense(expense);

        try {
            const { txHash, blockNumber, validatorNodeCount } =
                await submitHashWithTimeout(hash);

            await query(
                `INSERT INTO BlockchainLogs
                   (expenseID, actorID, txHash, blockNumber, eventType, validatorNodeCount, consensusType)
                 VALUES ($1, $2, $3, $4, 'ExpenseApproved', $5, 'Clique')`,
                [req.params.id, req.user.id, txHash, blockNumber, validatorNodeCount]
            );
            await query("UPDATE Expenses SET blockchainStatus = 'Confirmed' WHERE expenseID = $1", [req.params.id]);

            res.json({ status: "Approved", blockchain: { txHash, blockNumber, validatorNodeCount } });
        } catch (chainErr) {
            console.error("Blockchain submission deferred:", chainErr.message);
            await query("UPDATE Expenses SET blockchainStatus = 'Pending' WHERE expenseID = $1", [req.params.id]);
            res.status(202).json({
                status: "Approved",
                blockchain: null,
                warning: "Blockchain submission deferred — insufficient validator nodes online. Will retry automatically.",
            });
        }
    } catch (err) {
        next(err);
    }
});

// PATCH /:id/reject — PM/GM only. No blockchain write for rejected expenses.
router.patch("/:id/reject", requireRole("Project Manager", "General Manager"), async (req, res, next) => {
    try {
        const result = await query(
            "UPDATE Expenses SET status = 'Rejected', approvedBy = $1 WHERE expenseID = $2 RETURNING *",
            [req.user.id, req.params.id]
        );
        if (result.rowCount === 0) {
            const err = new Error("Expense not found");
            err.status = 404;
            throw err;
        }
        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

module.exports = router;