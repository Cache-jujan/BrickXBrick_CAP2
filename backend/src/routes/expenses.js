// expenses.js — F6 expense submission + ticket linking, plus review access.
// Table 35 (Expenses) already exists in 001_initial_schema.sql — no migration
// needed. This route just exposes it.

const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { receiptImageExists } = require("../lib/receiptStorage");
const { EXPENSE_COLUMNS, classifyBir, normalizeLineItems, computeQuantityFromLineItems } = require("../lib/receiptFields");
const { checkDuplicate, checkVendor } = require("../lib/fraudScreening");
const { canonicalizeExpense, submitHashWithTimeout } = require("../lib/blockchainService");

const router = express.Router();
router.use(requireAuth);

// Labor is intentionally excluded — the DB CHECK isn't built yet, so this is
// enforced here until that constraint lands.
const VALID_CATEGORIES = ["Materials", "Equipment", "Other"];

// Roles that may read any expense. Everyone else is scoped to their own.
const EXPENSE_READ_ALL_ROLES = ["General Manager", "Project Manager", "System Administrator"];

function httpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

// POST / — Purchaser submits an expense, linked to a Resolved ticket.
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
        } = req.body;

        // NOTE: birValidationStatus is deliberately NOT read from the body.
        // It decides what lands in the BIR tax-deductible report (F11), so a
        // client must not be able to declare its own receipt Formal. F7 is a
        // system-automated classification — it's derived below.

        if (!vendorName || amount === undefined || amount === null || !receiptDate) {
            throw httpError(400, "vendorName, amount, and receiptDate are required");
        }
        if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
            throw httpError(400, "amount must be a non-negative number");
        }
        if (!category || !VALID_CATEGORIES.includes(category)) {
            throw httpError(400, `category must be one of: ${VALID_CATEGORIES.join(", ")}`);
        }

        // receiptimageurl is NOT NULL, so confirm this is a receipt THIS
        // server stored via /receipts/scan. Without the check, any string
        // satisfies the column and the audit trail points at nothing.
        if (!receiptImageURL) {
            throw httpError(400, "receiptImageURL is required");
        }
        if (!(await receiptImageExists(receiptImageURL))) {
            throw httpError(400, "receiptImageURL must reference a receipt uploaded via POST /receipts/scan");
        }

        // quantity is no longer client-supplied — it's derived from
        // lineItems (same trust model as birValidationStatus below), so a
        // submission with no usable line items is rejected outright rather
        // than silently defaulting to 0/1.
        if (!Array.isArray(lineItems) || lineItems.length === 0) {
            throw badRequest("lineItems must include at least one item");
        }
        const storedLineItems = normalizeLineItems(lineItems);
        if (storedLineItems.length === 0) {
            throw badRequest("lineItems must be an array of { description: string, amount: number }");
        }
        const quantity = computeQuantityFromLineItems(storedLineItems);

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
                throw httpError(404, `Ticket ${ticketID} not found`);
            }
            const ticket = ticketResult.rows[0];

            if (ticket.assignedto !== req.user.id) {
                throw httpError(403, "You may only submit an expense against a ticket assigned to you");
            }
            // Strict Resolved-only. The mobile app now calls
            // PATCH /tickets/:id/resolve before hitting this endpoint
            // (Link screen submit handler) — accepting Acknowledged here
            // too would let a frontend regression skip that step silently.
            if (ticket.status !== "Resolved") {
                throw httpError(409, "Ticket must be Resolved before an expense can be linked to it");
            }

            projectID = ticket.projectid;
        }

        if (!projectID) {
            throw httpError(400, "projectID is required when no ticketID is provided");
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
                JSON.stringify(storedLineItems),
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

// GET / — GM/PM view of all expenses, optional ?projectId= filter (used by ProjectDetailPage)
router.get("/", requireRole("General Manager", "Project Manager"), async (req, res, next) => {
    try {
        const { projectId } = req.query;
        const conditions = [];
        const params = [];

        if (req.user.role === "Project Manager") {
            params.push(req.user.id);
            conditions.push(
                `e.projectID IN (SELECT projectId FROM projects WHERE projectManagerId = $${params.length})`
            );
        }
        if (projectId) {
            params.push(projectId);
            conditions.push(`e.projectID = $${params.length}`);
        }

        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const result = await query(
            `SELECT e.*, u.name AS submittedbyname
               FROM Expenses e JOIN Users u ON u.userid = e.submittedBy
               ${where}
              ORDER BY e.submittedAt DESC`,
            params
        );
        res.json(result.rows);
    } catch (err) { next(err); }
});

// GET /:id — role-scoped: Purchaser sees only their own submissions, GM can
// see any expense, a PM only expenses on projects they manage.
// The base scope lives in the WHERE clause rather than a post-fetch check,
// so a user with no plausible right to the row gets a plain 404 instead of
// a 403 that confirms the row exists; the finer PM-project scoping still
// needs assertCanReviewProject since it depends on a join we don't want to
// bake into every call.
router.get("/:id", async (req, res, next) => {
    try {
        const canReadAll = EXPENSE_READ_ALL_ROLES.includes(req.user.role);

        const result = await query(
            `SELECT ${EXPENSE_COLUMNS} FROM expenses
             WHERE expenseid = $1 AND ($2::boolean OR submittedby = $3)`,
            [req.params.id, canReadAll, req.user.id]
        );

        if (result.rowCount === 0) {
            throw httpError(404, "Not found");
        }
        const expense = result.rows[0];

        const isOwner = expense.submittedby === req.user.id;
        const isReviewer = ["Project Manager", "General Manager"].includes(req.user.role);

        if (!isOwner && !isReviewer) {
            throw httpError(403, "You do not have access to this expense record");
        }
        if (!isOwner && isReviewer) {
            await assertCanReviewProject(req.user, expense.projectid);
        }

        res.json(expense);
    } catch (err) {
        next(err);
    }
});

// PATCH /:id/approve — PM (own projects) or GM. Only a Pending expense can be
// approved. Marks Approved, then submits the SHA-256 hash to the Geth PoA
// cluster and persists the confirmed tx to BlockchainLogs. If nodes are
// insufficient, blockchainStatus stays "Pending" so a scheduled retry (see
// server.js) can pick it up later.
router.patch("/:id/approve", requireRole("Project Manager", "General Manager"), async (req, res, next) => {
    try {
        const result = await query("SELECT * FROM Expenses WHERE expenseID = $1", [req.params.id]);
        if (result.rowCount === 0) {
            throw httpError(404, "Expense not found");
        }
        const expense = result.rows[0];
        await assertCanReviewProject(req.user, expense.projectid);

        if (expense.status !== "Pending") {
            throw httpError(409, `Only a Pending expense can be approved (this one is ${expense.status})`);
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

// PATCH /:id/reject — PM (own projects) or GM. Only a Pending expense can be
// rejected: rejecting an Approved one would leave its on-chain record pointing
// at an expense that is no longer approved. No blockchain write on reject.
router.patch("/:id/reject", requireRole("Project Manager", "General Manager"), async (req, res, next) => {
    try {
        const existing = await query("SELECT * FROM Expenses WHERE expenseID = $1", [req.params.id]);
        if (existing.rowCount === 0) {
            throw httpError(404, "Expense not found");
        }
        const expense = existing.rows[0];
        await assertCanReviewProject(req.user, expense.projectid);

        if (expense.status !== "Pending") {
            throw httpError(409, `Only a Pending expense can be rejected (this one is ${expense.status})`);
        }

        const result = await query(
            "UPDATE Expenses SET status = 'Rejected', approvedBy = $1 WHERE expenseID = $2 RETURNING *",
            [req.user.id, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

module.exports = router;