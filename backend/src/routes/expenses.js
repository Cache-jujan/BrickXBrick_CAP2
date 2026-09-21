// expenses.js — F6 expense submission + ticket linking.

const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { receiptImageExists } = require("../lib/receiptStorage");
const { EXPENSE_COLUMNS, classifyBir, normalizeLineItems } = require("../lib/receiptFields");
const { checkDuplicate, checkVendor } = require("../lib/fraudScreening");
const { canonicalizeExpense, submitHashWithTimeout } = require("../lib/blockchainService");

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
// GET / — GM/PM view of all expenses, optional ?projectId= filter (used by ProjectDetailPage)
router.get("/", requireRole("General Manager", "Project Manager"), async (req, res, next) => {
    try {
        const { projectId } = req.query;
        const base = `SELECT e.*, u.name AS submittedbyname
                      FROM Expenses e JOIN Users u ON u.userid = e.submittedBy`;
        const result = projectId
            ? await query(`${base} WHERE e.projectID = $1 ORDER BY e.submittedAt DESC`, [projectId])
            : await query(`${base} ORDER BY e.submittedAt DESC`);
        res.json(result.rows);
    } catch (err) { next(err); }
});

// GET /:id — role-scoped: Purchaser sees only their own submissions,
// GM/PM can see any expense (they need this for review/approval/reporting).
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