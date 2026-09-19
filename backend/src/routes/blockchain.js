const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { canonicalizeExpense, getOnChainHash } = require("../lib/blockchainService");

const router = express.Router();
router.use(requireAuth);

// GET /api/blockchain/verify/:expenseId — General Manager only.
router.get("/verify/:expenseId", requireRole("General Manager"), async (req, res, next) => {
    try {
        const expenseResult = await query("SELECT * FROM Expenses WHERE expenseID = $1", [req.params.expenseId]);
        if (expenseResult.rowCount === 0) {
            const err = new Error("Expense not found");
            err.status = 404;
            throw err;
        }
        const expense = expenseResult.rows[0];

        const logResult = await query(
            "SELECT * FROM BlockchainLogs WHERE expenseID = $1 ORDER BY timestamp DESC LIMIT 1",
            [req.params.expenseId]
        );
        if (logResult.rowCount === 0) {
            return res.status(404).json({ error: "No blockchain record exists for this expense yet" });
        }
        const log = logResult.rows[0];

        const recomputedHash = canonicalizeExpense(expense);
        const onChainHash = await getOnChainHash(log.txhash);

        if (recomputedHash === onChainHash) {
            return res.json({
                verified: true,
                txHash: log.txhash,
                blockNumber: log.blocknumber,
                timestamp: log.timestamp,
            });
        }

        // Tamper detected — log permanently, flag SysAdmin.
        await query(
            `INSERT INTO tamper_alerts (expenseID, recomputedHash, onChainHash)
             VALUES ($1, $2, $3)`,
            [req.params.expenseId, recomputedHash, onChainHash]
        );
        await query("UPDATE Expenses SET blockchainStatus = 'TamperDetected' WHERE expenseID = $1", [req.params.expenseId]);

        res.json({
            verified: false,
            recomputedHash,
            onChainHash,
            message: "TAMPER ALERT: record does not match blockchain. Logged and flagged for System Administrator.",
        });
    } catch (err) {
        next(err);
    }
});

// GET /api/blockchain/alerts — GM/SysAdmin view of open tamper alerts.
router.get("/alerts", requireRole("General Manager", "System Administrator"), async (req, res, next) => {
    try {
        const result = await query(
            "SELECT * FROM tamper_alerts WHERE resolvedAt IS NULL ORDER BY detectedAt DESC"
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
            `SELECT bl.txhash, bl.blocknumber, bl.timestamp, bl.expenseid, bl.validatornodecount
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

module.exports = router;
// PATCH /api/blockchain/alerts/:id/resolve — GM/SysAdmin marks an alert as
// investigated.
router.patch("/alerts/:id/resolve", requireRole("General Manager", "System Administrator"), async (req, res, next) => {
    try {
        const result = await query(
            "UPDATE tamper_alerts SET resolvedAt = NOW() WHERE alertID = $1 AND resolvedAt IS NULL RETURNING *",
            [req.params.id]
        );
        if (result.rowCount === 0) {
            const err = new Error("Alert not found or already resolved");
            err.status = 404;
            throw err;
        }
        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});