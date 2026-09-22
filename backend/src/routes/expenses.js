// expenses.js — F6 expense submission + ticket linking, plus review access.
// Table 35 (Expenses) already exists in 001_initial_schema.sql — no migration
// needed. This route just exposes it.

const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { checkDuplicate, checkVendor } = require("../lib/fraudScreening");
const { canonicalizeExpense, submitHashWithTimeout } = require("../lib/blockchainService");

const router = express.Router();
router.use(requireAuth);

// Labor is intentionally excluded — schema comment notes the DB CHECK isn't
// built yet, so this is enforced here until that constraint lands.
const VALID_CATEGORIES = ["Materials", "Equipment", "Other"];
const VALID_BIR_STATUSES = ["Formal-Tax-Deductible", "Informal"];

function httpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

// General Manager may review any project's expenses. A Project Manager may
// only review expenses on projects they are assigned to (same rule as
// assertProjectAccess in projects.js).
async function assertCanReviewProject(user, projectId) {
    if (user.role === "General Manager") return;
    const result = await query(
        "SELECT projectManagerId FROM projects WHERE projectId = $1",
        [projectId]
    );
    if (result.rowCount === 0 || result.rows[0].projectmanagerid !== user.id) {
        throw httpError(403, "You may only review expenses on projects you manage");
    }
}

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
            throw httpError(400, "vendorName, amount, and receiptDate are required");
        }
        if (typeof amount !== "number" || amount < 0) {
            throw httpError(400, "amount must be a non-negative number");
        }
        if (!category || !VALID_CATEGORIES.includes(category)) {
            throw httpError(400, `category must be one of: ${VALID_CATEGORIES.join(", ")}`);
        }
        if (!birValidationStatus || !VALID_BIR_STATUSES.includes(birValidationStatus)) {
            throw httpError(400, `birValidationStatus must be one of: ${VALID_BIR_STATUSES.join(", ")}`);
        }
        if (!receiptImageURL) {
            throw httpError(400, "receiptImageURL is required");
        }
        if (quantity === undefined || quantity === null || typeof quantity !== "number" || quantity < 0) {
            throw httpError(400, "quantity is required and must be a non-negative number");
        }
        // lineItems is nullable at the DB level, but if it's present it must
        // be well-formed — a malformed array shouldn't silently write junk.
        if (lineItems !== undefined && lineItems !== null && !isValidLineItems(lineItems)) {
            throw httpError(400, "lineItems must be an array of { description: string, amount: number }");
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
                throw httpError(404, `Ticket ${ticketID} not found`);
            }
            const ticket = ticketResult.rows[0];

            if (ticket.assignedto !== req.user.id) {
                throw httpError(403, "You may only submit an expense against a ticket assigned to you");
            }
            if (ticket.status !== "Resolved") {
                throw httpError(409, "Ticket must be Resolved before an expense can be linked to it");
            }

            projectID = ticket.projectid;
        }

        if (!projectID) {
            throw httpError(400, "projectID is required when no ticketID is provided");
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

// GET / — GM sees all expenses; a PM sees only expenses on projects they
// manage. Optional ?projectId= filter (used by ProjectDetailPage).
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
router.get("/:id", async (req, res, next) => {
    try {
        const result = await query("SELECT * FROM Expenses WHERE expenseID = $1", [req.params.id]);
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
