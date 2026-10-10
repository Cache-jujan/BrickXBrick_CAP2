const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { resolveTamperAlert } = require("../lib/tamperAlerts");
const { checkExpenseIntegrity } = require("../lib/integrityCheck");

const router = express.Router();
router.use(requireAuth);

// GET /api/blockchain/verify/:expenseId — General Manager only.
// Same check as the background scan (lib/integrityCheck.js): compares the
// expense with the hash secured on the chain when it was approved.
router.get("/verify/:expenseId", requireRole("General Manager"), async (req, res, next) => {
    try {
        const expenseResult = await query("SELECT * FROM Expenses WHERE expenseID = $1::uuid", [req.params.expenseId]);
        if (expenseResult.rowCount === 0) {
            const err = new Error("Expense not found");
            err.status = 404;
            throw err;
        }
        const result = await checkExpenseIntegrity(expenseResult.rows[0]);

        if (result.state === "NotSecured") {
            return res.status(404).json({ error: "This expense hasn't been secured yet, so there's nothing to check against." });
        }
        // UC-12-01 E3: node unreachable is NOT tampering — tell the GM to retry.
        if (result.state === "Unreachable") {
            return res.status(503).json({
                error: "We can't run the check right now because the verification servers didn't respond. Your records are safe. Try again in a few minutes.",
            });
        }
        if (result.state === "Match") {
            return res.json({
                verified: true,
                txHash: result.log.txhash,
                blockNumber: result.log.blocknumber,
                timestamp: result.log.timestamp,
            });
        }
        res.json({
            verified: false,
            recomputedHash: result.recomputedHash,
            onChainHash: result.onChainHash || "MISSING",
            message: "This expense was changed after approval. It has been logged and your System Administrator has been notified.",
        });
    } catch (err) {
        next(err);
    }
});

// GET /api/blockchain/alerts?status=open|reviewed|all — GM/SysAdmin.
// Default "open" (the sidebar badge uses it). Reviewed alerts stay listed
// with who reviewed them, when and why.
router.get("/alerts", requireRole("General Manager", "System Administrator"), async (req, res, next) => {
    try {
        const status = ["open", "reviewed", "all"].includes(req.query.status) ? req.query.status : "open";
        const where = status === "open" ? "WHERE ta.resolvedat IS NULL"
            : status === "reviewed" ? "WHERE ta.resolvedat IS NOT NULL" : "";
        const result = await query(
            `SELECT ta.alertid, ta.expenseid, ta.recomputedhash, ta.onchainhash, ta.detectedat,
                    ta.resolvedat, ta.resolutionnote, ta.restoredat, ta.notifiedsysadmin,
                    rb.name AS resolvedbyname, rb.role AS resolvedbyrole,
                    e.vendorname, e.amount, e.projectid, e.blockchainstatus, e.approvedby,
                    ab.name AS approvedbyname, p.name AS projectname
               FROM tamper_alerts ta
               JOIN Expenses e ON e.expenseid = ta.expenseid
               LEFT JOIN Projects p ON p.projectid = e.projectid
               LEFT JOIN users rb ON rb.userid = ta.resolvedby
               LEFT JOIN users ab ON ab.userid = e.approvedby
              ${where}
              ORDER BY COALESCE(ta.resolvedat, ta.detectedat) DESC`
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// GET /project/:projectId — summary for the project's Financial/Blockchain section.
// GM/PM only (same access level as viewing the project itself).
router.get("/project/:projectId", requireRole("General Manager", "Project Manager"), async (req, res, next) => {
    try {
        const logsResult = await query(
            `SELECT bl.txhash, bl.blocknumber, bl.timestamp, bl.expenseid, bl.validatornodecount,
                    e.vendorname, e.amount, e.blockchainstatus
               FROM BlockchainLogs bl
               JOIN Expenses e ON e.expenseid = bl.expenseid
              WHERE e.projectid = $1
              ORDER BY bl.timestamp DESC`,
            [req.params.projectId]
        );

        const alertsResult = await query(
            `SELECT ta.alertid, ta.expenseid, ta.detectedat
               FROM tamper_alerts ta
               JOIN Expenses e ON e.expenseid = ta.expenseid
              WHERE e.projectid = $1 AND ta.resolvedat IS NULL`,
            [req.params.projectId]
        );

        res.json({
            confirmedCount: logsResult.rowCount,
            lastCheckedAt: logsResult.rows[0]?.timestamp || null,
            logs: logsResult.rows,
            openAlerts: alertsResult.rows,
        });
    } catch (err) {
        next(err);
    }
});

// PATCH /api/blockchain/alerts/:id/resolve — GM/SysAdmin marks an alert
// as reviewed. Body { note } is required. The alert stays on record and the
// expense keeps its "changed after approval" status (lib/tamperAlerts.js).
router.patch("/alerts/:id/resolve", requireRole("General Manager", "System Administrator"), async (req, res, next) => {
    try {
        const alert = await resolveTamperAlert({ alertId: req.params.id, user: req.user, note: req.body?.note });
        res.json(alert);
    } catch (err) {
        next(err);
    }
});

// GET /api/blockchain/summary — GM only. Aggregate across all projects.
router.get("/summary", requireRole("General Manager"), async (req, res, next) => {
    try {
        const confirmed = await query(
            "SELECT COUNT(*)::int AS count FROM Expenses WHERE blockchainStatus = 'Confirmed'"
        );
        const pending = await query(
            "SELECT COUNT(*)::int AS count FROM Expenses WHERE blockchainStatus = 'Pending'"
        );
        const tampered = await query(
            "SELECT COUNT(*)::int AS count FROM Expenses WHERE blockchainStatus = 'TamperDetected'"
        );
        res.json({
            confirmedCount: confirmed.rows[0].count,
            pendingCount: pending.rows[0].count,
            tamperedCount: tampered.rows[0].count,
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;