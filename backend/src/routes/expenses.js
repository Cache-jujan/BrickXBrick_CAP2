// expenses.js — F6 expense submission + ticket linking.
// Table 35 (Expenses) already exists in 001_initial_schema.sql — no migration
// needed. This route just exposes it.

const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { checkDuplicate, checkVendor } = require("../lib/fraudScreening");


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

        const vendorIssue = await checkVendor(expense);
        if (vendorIssue) {
            const reason = vendorIssue === "not_found"
                ? "Vendor not found in VendorMasterList"
                : "Vendor found in VendorMasterList but approvalStatus = 'Flagged'";

            await query(
                `INSERT INTO FraudFlags (expenseID, flaggedBy, flagType, reason)
                 VALUES ($1, 'system', 'Vendor_Validation', $2)`,
                [expense.expenseid, reason]
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

// GET /:id — single expense.
router.get("/:id", async (req, res, next) => {
    try {
        const result = await query("SELECT * FROM Expenses WHERE expenseID = $1", [req.params.id]);
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
