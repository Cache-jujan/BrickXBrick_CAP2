// expenses.js — F6 expense submission + ticket linking, plus review access.
// Table 35 (Expenses) already exists in 001_initial_schema.sql — no migration
// needed. This route just exposes it.

const express = require("express");
const { query, withTransaction } = require("../lib/db");
const { isTicketFulfilled, FULFILLED_MESSAGE } = require("../lib/ticketAvailability");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { receiptImageExists } = require("../lib/receiptStorage");
const { EXPENSE_COLUMNS, classifyBir, normalizeBirFields, normalizeLineItems, computeQuantityFromLineItems } = require("../lib/receiptFields");
const { assertProjectActive } = require("../lib/projectRules");
const { screenExpense } = require("../lib/screenExpense");
const { canonicalizeExpenseV2, submitHashWithTimeout } = require("../lib/blockchainService");

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

// Shared PM/GM project-scoping check for expense submit/approve/reject.
async function assertCanReviewProject(user, projectId) {
    if (user.role === "General Manager") return;

    const result = await query(
        "SELECT projectManagerId FROM projects WHERE projectId = $1",
        [projectId]
    );
    if (result.rowCount === 0) {
        throw httpError(404, `Project ${projectId} not found`);
    }
    if (result.rows[0].projectmanagerid !== user.id) {
        throw httpError(403, "You may only act on expenses for projects you manage");
    }
}

async function assertSiteManagerProject(user, projectId) {
    const result = await query(
        "SELECT siteManagerId FROM projects WHERE projectId = $1",
        [projectId]
    );
    if (result.rowCount === 0) {
        throw httpError(404, `Project ${projectId} not found`);
    }
    if (result.rows[0].sitemanagerid !== user.id) {
        throw httpError(403, "You may only submit expenses for tickets on projects assigned to you");
    }
}

const SCREENING_FAILED_REASON =
    "Automatic fraud screening could not run for this expense. Review it manually before approving.";

/**
 * Run F9 screening on a saved expense without letting a screening failure
 * undo it. The expense row is already committed, so a throw here used to make
 * the client see a 500 for an expense that was in fact saved (and retry it).
 * If screening throws, a Screening_Failed flag is written instead, so the
 * expense lands in the PM's flagged queue rather than looking clean.
 */
async function screenOrFlag(expenseID) {
    try {
        await screenExpense(expenseID);
    } catch (err) {
        console.error(`Expense ${expenseID} failed screening:`, err);
        try {
            await query(
                `INSERT INTO FraudFlags (expenseID, flagType, reason, flaggedBy, resolution)
                 VALUES ($1, 'Screening_Failed', $2, 'system', 'Pending')`,
                [expenseID, SCREENING_FAILED_REASON]
            );
        } catch (flagErr) {
            console.error(`Expense ${expenseID}: could not record the screening failure:`, flagErr);
        }
    }
}

/**
 * Submit an expense after validating receipt, project access and ticket rules.
 * Purchasers need assigned resolved tickets; Site Managers need their own resolved
 * Material Requests. Managers may use accessible resolved Material Requests.
 */
router.post("/", requireRole("Purchaser", "Site Manager", "General Manager", "Project Manager"), async (req, res, next) => {
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
        // client must not be able to declare its own receipt Formal.

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
        // server stored via /receipts/scan.
        if (!receiptImageURL) {
            throw httpError(400, "receiptImageURL is required");
        }
        if (!(await receiptImageExists(receiptImageURL))) {
            throw httpError(400, "receiptImageURL must reference a receipt uploaded via POST /receipts/scan");
        }

        // quantity is derived from lineItems, never client-supplied.
        if (!Array.isArray(lineItems) || lineItems.length === 0) {
            throw httpError(400, "lineItems must include at least one item");
        }
        const storedLineItems = normalizeLineItems(lineItems);
        if (storedLineItems.length === 0) {
            throw httpError(400, "lineItems must be an array of { description: string, amount: number }");
        }
        const quantity = computeQuantityFromLineItems(storedLineItems);

        // Normalize BIR fields first so Layer 1's exact match can't be dodged
        // by spacing or hyphens ("OR 4567" vs "OR-4567").
        const bir = normalizeBirFields({ tin, birPermitNumber, birNumber });
        const { birValidationStatus } = classifyBir(bir);

        // When a ticket is given, the ticket is the source of truth for the
        // project — not the client-supplied projectID (F9 Layer 3).
        let projectID = bodyProjectID;

        if (ticketID) {
            const ticketResult = await query(
                "SELECT ticketid, projectid, status, assignedto, submittedby, tickettype, quantity FROM tickets WHERE ticketid = $1",
                [ticketID]
            );
            if (ticketResult.rowCount === 0) {
                throw httpError(404, `Ticket ${ticketID} not found`);
            }
            const ticket = ticketResult.rows[0];

            if (req.user.role === "Purchaser") {
                if (ticket.assignedto !== req.user.id) {
                    throw httpError(403, "You may only submit an expense against a ticket assigned to you");
                }
            } else if (req.user.role === "Site Manager") {
                if (ticket.submittedby !== req.user.id) {
                    throw httpError(403, "You may only submit an expense against a ticket you created");
                }
                if (ticket.tickettype !== "Material Request") {
                    throw httpError(400, "Site Manager expenses can only be linked to a Material Request ticket");
                }
            } else if (ticket.tickettype !== "Material Request") {
                throw httpError(400, "GM/PM expenses can only be linked to a Material Request ticket");
            }

            // Strict Resolved-only. Purchasers resolve their assigned tickets;
            // GM/PM may link only after the assigned Purchaser has completed it.
            if (ticket.status !== "Resolved") {
                throw httpError(409, "Ticket must be Resolved before an expense can be linked to it");
            }
            // A receipt scanned earlier may belong to a request that has since
            // been filled. Don't let it become a second expense for the same buy.
            if (await isTicketFulfilled(query, ticket.ticketid, ticket.quantity)) {
                throw httpError(409, FULFILLED_MESSAGE);
            }

            projectID = ticket.projectid;
        }

        if (req.user.role === "Site Manager" && !ticketID) {
            throw httpError(400, "Site Managers must link expenses to their own resolved Material Request ticket");
        }
        // Without a ticket, Layer 3 and the assignment check are skipped and a
        // Purchaser could bill any Active project.
        if (req.user.role === "Purchaser" && !ticketID) {
            throw httpError(400, "Purchasers must link expenses to a Resolved ticket assigned to them");
        }
        if (!projectID) {
            throw httpError(400, "projectID is required when no ticketID is provided");
        }
        // Purchases are recorded only against an Active project.
        await assertProjectActive(query, projectID, "Recording an expense");
        // A PM is limited to managed projects; a GM can use any project;
        // Site Managers must still be assigned to the ticket's project.
        if (req.user.role === "Site Manager") {
            await assertSiteManagerProject(req.user, projectID);
        } else if (req.user.role !== "Purchaser") {
            await assertCanReviewProject(req.user, projectID);
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
                bir.birNumber,
                bir.tin,
                bir.birPermitNumber,
                JSON.stringify(storedLineItems),
                quantity,
            ]
        );

        const expense = result.rows[0];

        // F9 Layers 1-3. No transaction here, so the row is already visible
        // to screenExpense's queries. A screening failure is recorded as a
        // flag (see screenOrFlag), never as an error to the client.
        await screenOrFlag(expense.expenseID);

        res.status(201).json(expense);
    } catch (err) {
        next(err);
    }
});

// GET /mine — the caller's own submitted expenses.
router.get("/mine", requireRole("Purchaser", "Site Manager"), async (req, res, next) => {
    try {
        const result = await query(
            // splitProjectCount: how many projects a split receipt was shared across
            // (0 for an ordinary single-request expense).
            // ticketSubject / projectName / commonReceiptID let the app's History tab show
            // what each receipt was for and group the portions of one split receipt.
            `SELECT ${EXPENSE_COLUMNS},
                    (SELECT COUNT(DISTINCT a.projectID)::int FROM ReceiptAllocations a
                      WHERE a.expenseID = expenses.expenseID) AS "splitProjectCount",
                    (SELECT t.subject FROM tickets t WHERE t.ticketID = expenses.ticketID) AS "ticketSubject",
                    (SELECT p.name FROM projects p WHERE p.projectID = expenses.projectID) AS "projectName",
                    (SELECT a.commonReceiptID FROM ReceiptAllocations a
                      WHERE a.expenseID = expenses.expenseID LIMIT 1) AS "commonReceiptID"
               FROM expenses
              WHERE submittedby = $1 ORDER BY submittedat DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// GET /flagged — PM/GM queue of Pending expenses with unresolved fraud flags.
// Must stay ABOVE "/:id" or Express treats "flagged" as an id.
router.get("/flagged", requireRole("Project Manager", "General Manager"), async (req, res, next) => {
    try {
        const conditions = ["e.status = 'Pending'", "ff.resolution = 'Pending'"];
        const params = [];

        if (req.user.role === "Project Manager") {
            params.push(req.user.id);
            conditions.push(`e.projectID IN (SELECT projectId FROM projects WHERE projectManagerId = $${params.length})`);
        }

        // A PM only sees the details of an earlier matching expense that belongs to a project they manage.
        const canSeeDuplicate = req.user.role === "Project Manager"
            ? `d.projectID IN (SELECT projectId FROM projects WHERE projectManagerId = $1)`
            : "TRUE";

        // Beyond the flags themselves, the reviewer needs: the project, what was requested, the other
        // projects sharing this receipt, and the earlier expense a BIR duplicate flag points at.
        const result = await query(
            `SELECT e.*, u.name AS submittedbyname,
                    p.name AS projectname,
                    json_agg(json_build_object('flagType', ff.flagType, 'reason', ff.reason, 'flaggedAt', ff.flaggedAt)) AS flags,
                    (SELECT json_build_object('subject', t.subject, 'materialType', t.materialType, 'quantity', t.quantity,
                                              'unit', t.unit, 'approvedBudget', t.approvedBudget, 'vendorName', t.vendorName)
                       FROM Tickets t WHERE t.ticketID = e.ticketID) AS ticket,
                    (SELECT json_agg(json_build_object('expenseId', e2.expenseID, 'projectName', p2.name,
                                                       'amount', e2.amount, 'status', e2.status))
                       FROM ReceiptAllocations ra
                       JOIN ReceiptAllocations ra2 ON ra2.commonReceiptID = ra.commonReceiptID AND ra2.expenseID <> e.expenseID
                       JOIN Expenses e2 ON e2.expenseID = ra2.expenseID
                       JOIN Projects p2 ON p2.projectID = e2.projectID
                      WHERE ra.expenseID = e.expenseID) AS siblings,
                    (SELECT CASE WHEN ${canSeeDuplicate}
                                 THEN json_build_object('expenseId', d.expenseID, 'vendorName', d.vendorName, 'amount', d.amount,
                                                        'receiptDate', d.receiptDate, 'projectName', pd.name,
                                                        'receiptImageURL', d.receiptImageURL)
                                 ELSE json_build_object('hidden', TRUE) END
                       FROM Expenses d
                       JOIN Projects pd ON pd.projectID = d.projectID
                      WHERE d.status = 'Approved' AND d.expenseID <> e.expenseID
                        AND e.tin IS NOT NULL AND e.birPermitNumber IS NOT NULL AND e.birNumber IS NOT NULL
                        AND d.tin = e.tin AND d.birPermitNumber = e.birPermitNumber AND d.birNumber = e.birNumber
                        AND NOT EXISTS (SELECT 1 FROM ReceiptAllocations a, ReceiptAllocations b
                                         WHERE a.expenseID = e.expenseID AND b.expenseID = d.expenseID
                                           AND a.commonReceiptID = b.commonReceiptID)
                      ORDER BY d.submittedAt ASC
                      LIMIT 1) AS duplicateof
               FROM Expenses e
               JOIN Users u ON u.userid = e.submittedBy
               JOIN Projects p ON p.projectID = e.projectID
               JOIN FraudFlags ff ON ff.expenseID = e.expenseID
              WHERE ${conditions.join(" AND ")}
              GROUP BY e.expenseID, u.name, p.name
              ORDER BY e.submittedAt ASC`,
            params
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// GET / — GM/PM view of all expenses, optional ?projectId= filter.
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
            // The extra columns label the row: what it was bought for, whether it is a trip cost
            // (gas, toll, delivery: no request), and the other projects sharing the same receipt.
            `SELECT e.*, u.name AS submittedbyname,
                    (SELECT t.subject FROM Tickets t WHERE t.ticketID = e.ticketID) AS ticketsubject,
                    (e.ticketID IS NULL AND e.submitNote LIKE 'Trip cost:%') AS istripcost,
                    (SELECT ra.commonReceiptID FROM ReceiptAllocations ra WHERE ra.expenseID = e.expenseID LIMIT 1) AS commonreceiptid,
                    (SELECT json_agg(json_build_object('expenseId', e2.expenseID, 'projectName', p2.name,
                                                       'amount', e2.amount, 'status', e2.status))
                       FROM ReceiptAllocations ra
                       JOIN ReceiptAllocations ra2 ON ra2.commonReceiptID = ra.commonReceiptID AND ra2.expenseID <> e.expenseID
                       JOIN Expenses e2 ON e2.expenseID = ra2.expenseID
                       JOIN Projects p2 ON p2.projectID = e2.projectID
                      WHERE ra.expenseID = e.expenseID) AS siblings
               FROM Expenses e JOIN Users u ON u.userid = e.submittedBy
               ${where}
              ORDER BY e.submittedAt DESC`,
            params
        );
        res.json(result.rows);
    } catch (err) { next(err); }
});

// GET /:id — role-scoped: Purchaser sees only their own submissions, GM any,
// PM only expenses on projects they manage.
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

        const isOwner = expense.submittedBy === req.user.id;
        const isReviewer = ["Project Manager", "General Manager"].includes(req.user.role);

        if (!isOwner && !isReviewer) {
            throw httpError(403, "You do not have access to this expense record");
        }
        if (!isOwner && isReviewer) {
            await assertCanReviewProject(req.user, expense.projectID);
        }

        res.json(expense);
    } catch (err) {
        next(err);
    }
});

/**
 * Approve a Pending expense as its project's PM or a GM, atomically resolving flags.
 * Then submit its SHA-256 hash to the Geth PoA cluster and log the confirmed
 * transaction. Insufficient nodes leave blockchainStatus Pending for retry.
 */
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

        // General Managers may review their own submissions when needed;
        // Project Managers remain subject to separation of duties.
        if (expense.submittedby === req.user.id && req.user.role !== "General Manager") {
            throw httpError(403, "You can't approve an expense you submitted");
        }

        /** Atomically approve a Pending expense and its flags and tell its submitter; throw 409 if already reviewed. */
        await withTransaction(async (client) => {
            const claimed = await client.query(
                "UPDATE Expenses SET status = 'Approved', approvedBy = $1, approvedAt = NOW() WHERE expenseID = $2 AND status = 'Pending'",
                [req.user.id, req.params.id]
            );
            if (claimed.rowCount === 0) {
                throw httpError(409, "This expense was already reviewed");
            }
            await client.query(
                "UPDATE FraudFlags SET resolution = 'Approved', reviewedBy = $1, resolvedAt = NOW() WHERE expenseID = $2 AND resolution = 'Pending'",
                [req.user.id, req.params.id]
            );
            if (expense.submittedby !== req.user.id) {
                await client.query(
                    `INSERT INTO notifications (recipientId, type, relatedEntityType, relatedEntityId, message)
                     VALUES ($1, 'ExpenseApproved', 'Expense', $2, $3)`,
                    [expense.submittedby, req.params.id, `Your expense was approved: ${expense.vendorname}`]
                );
            }
        });

        // Read the row again so the fingerprint includes who approved it.
        const approved = await query("SELECT * FROM Expenses WHERE expenseID = $1", [req.params.id]);
        const hash = canonicalizeExpenseV2(approved.rows[0]);

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

/**
 * Reject a Pending expense as its project's PM or a GM, requiring a body reason.
 * Resolve flags and notify the submitter in the same transaction; no blockchain write.
 */
router.patch("/:id/reject", requireRole("Project Manager", "General Manager"), async (req, res, next) => {
    try {
        const { reason } = req.body;
        if (!reason || typeof reason !== "string" || !reason.trim()) {
            throw httpError(400, "reason is required");
        }

        const existing = await query("SELECT * FROM Expenses WHERE expenseID = $1", [req.params.id]);
        if (existing.rowCount === 0) {
            throw httpError(404, "Expense not found");
        }
        const expense = existing.rows[0];
        await assertCanReviewProject(req.user, expense.projectid);

        if (expense.status !== "Pending") {
            throw httpError(409, `Only a Pending expense can be rejected (this one is ${expense.status})`);
        }

        if (expense.submittedby === req.user.id) {
            throw httpError(403, "You can't reject an expense you submitted");
        }

        /** Reject a Pending expense, resolve its flags and notify its submitter in one transaction. */
        const rejected = await withTransaction(async (client) => {
            const result = await client.query(
                "UPDATE Expenses SET status = 'Rejected', approvedBy = $1, rejectionReason = $2 WHERE expenseID = $3 AND status = 'Pending' RETURNING *",
                [req.user.id, reason.trim(), req.params.id]
            );
            if (result.rowCount === 0) {
                throw httpError(409, "This expense was already reviewed");
            }
            await client.query(
                "UPDATE FraudFlags SET resolution = 'Rejected', reviewedBy = $1, resolvedAt = NOW() WHERE expenseID = $2 AND resolution = 'Pending'",
                [req.user.id, req.params.id]
            );
            await client.query(
                `INSERT INTO notifications (recipientId, type, relatedEntityType, relatedEntityId, message)
                 VALUES ($1, 'ExpenseRejected', 'Expense', $2, $3)`,
                [expense.submittedby, req.params.id, `Your expense was rejected: ${reason.trim()}`]
            );
            return result.rows[0];
        });

        res.json(rejected);
    } catch (err) {
        next(err);
    }
});

// PATCH /:id/resubmit — Purchaser edits and resubmits their own Rejected
// expense. Resets to Pending and clears rejectionReason.
router.patch("/:id/resubmit", requireRole("Purchaser"), async (req, res, next) => {
    try {
        // Only the Purchaser who submitted it, and only a Rejected one.
        const existing = await query(
            "SELECT * FROM Expenses WHERE expenseID = $1 AND submittedBy = $2",
            [req.params.id, req.user.id]
        );
        if (existing.rowCount === 0) {
            throw httpError(404, "Expense not found");
        }
        if (existing.rows[0].status !== "Rejected") {
            throw httpError(409, "Only a Rejected expense can be resubmitted");
        }

        const {
            vendorName,
            amount,
            receiptDate,
            category,
            birNumber,
            tin,
            birPermitNumber,
            lineItems,
        } = req.body;

        // Same validation as a new submission. birValidationStatus and
        // quantity are derived server-side, never taken from the client.
        if (!vendorName || amount === undefined || amount === null || !receiptDate) {
            throw httpError(400, "vendorName, amount, and receiptDate are required");
        }
        if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
            throw httpError(400, "amount must be a non-negative number");
        }
        if (!category || !VALID_CATEGORIES.includes(category)) {
            throw httpError(400, `category must be one of: ${VALID_CATEGORIES.join(", ")}`);
        }
        if (!Array.isArray(lineItems) || lineItems.length === 0) {
            throw httpError(400, "lineItems must include at least one item");
        }
        const storedLineItems = normalizeLineItems(lineItems);
        if (storedLineItems.length === 0) {
            throw httpError(400, "lineItems must be an array of { description: string, amount: number }");
        }
        const quantity = computeQuantityFromLineItems(storedLineItems);

        // Normalize BIR fields so Layer 1's exact match can't be dodged.
        const bir = normalizeBirFields({ tin, birPermitNumber, birNumber });
        const { birValidationStatus } = classifyBir(bir);

        // The receipt image, ticket link and project are NOT changed on a
        // resubmit — only the correctable fields. The receipt already exists.
        const result = await query(
            `UPDATE expenses
                SET vendorname = $1, amount = $2, receiptdate = $3, category = $4,
                    birvalidationstatus = $5, birnumber = $6, tin = $7,
                    birpermitnumber = $8, lineitems = $9, quantity = $10,
                    status = 'Pending', rejectionreason = NULL, approvedby = NULL
              WHERE expenseid = $11
              RETURNING ${EXPENSE_COLUMNS}`,
            [
                vendorName,
                amount,
                receiptDate,
                category,
                birValidationStatus,
                bir.birNumber,
                bir.tin,
                bir.birPermitNumber,
                JSON.stringify(storedLineItems),
                quantity,
                req.params.id,
            ]
        );

        const expense = result.rows[0];

        // Clear only the still-open system flags before re-screening, so a
        // corrected expense doesn't keep stale "duplicate"/"unknown vendor"
        // flags. Flags the PM already resolved (Approved/Rejected) are kept as
        // the review history, including why the expense was rejected.
        await query(
            "DELETE FROM FraudFlags WHERE expenseID = $1 AND flaggedBy = 'system' AND resolution = 'Pending'",
            [req.params.id]
        );

        // Re-run F9 Layers 1-3 on the corrected data.
        await screenOrFlag(expense.expenseID);

        res.json(expense);
    } catch (err) {
        next(err);
    }
});

module.exports = router;