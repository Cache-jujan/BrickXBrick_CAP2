const { query: defaultQuery } = require("./db");

const PESO = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

function money(expense) {
    const amount = Number(expense.amount);
    return Number.isFinite(amount) ? PESO.format(amount) : `₱${expense.amount}`;
}

// Notification text shown to General Managers and System Administrators.
// Written for non-technical readers; the technical detail (hashes, tx id)
// stays in tamper_alerts and the server log.
function tamperMessage(expense, onChainHash) {
    if (onChainHash === null || onChainHash === undefined || onChainHash === "MISSING") {
        return `We couldn't find the tamper-proof copy of "${expense.vendorname}" (${money(expense)}). Please contact your System Administrator.`;
    }
    return `"${expense.vendorname}" (${money(expense)}) was changed after it was approved. Its details no longer match the approved record.`;
}

// Everyone who must hear about tampering: every active System Administrator
// and General Manager, plus the project's creator.
async function alertRecipients(runQuery, projectId, excludeUserId = null) {
    const r = await runQuery(
        `SELECT userid FROM users
          WHERE status = 'Active' AND role IN ('System Administrator', 'General Manager')
         UNION
         SELECT createdby FROM projects WHERE projectid = $1::uuid`,
        [projectId]
    );
    return r.rows.map((row) => row.userid).filter((id) => id && id !== excludeUserId);
}

/**
 * Records a tamper alert for this version of the expense's data, unless one
 * already exists. "Version" = the recomputed hash, so:
 *   - repeated checks of the same change don't pile up alerts;
 *   - if the alert row is deleted, the next check creates it again;
 *   - a further change to the data (new hash) gets its own alert.
 */
async function raiseTamperAlert(expense, recomputedHash, onChainHash, reason, deps = {}) {
    const runQuery = deps.query || defaultQuery;
    const existing = await runQuery(
        `SELECT alertID FROM tamper_alerts
          WHERE expenseID = $1::uuid AND recomputedHash = $2 AND restoredAt IS NULL
          LIMIT 1`,
        [expense.expenseid, recomputedHash]
    );
    if (existing.rowCount > 0) return { created: false };

    const ins = await runQuery(
        `INSERT INTO tamper_alerts (expenseID, recomputedHash, onChainHash)
         VALUES ($1::uuid, $2, $3) RETURNING alertid`,
        [expense.expenseid, recomputedHash, onChainHash || "MISSING"]
    );

    const message = tamperMessage(expense, onChainHash);
    console.log(`TAMPER DETECTED on expense ${expense.expenseid} — ${reason}`);
    try {
        for (const id of await alertRecipients(runQuery, expense.projectid)) {
            await runQuery(
                `INSERT INTO notifications (recipientId, type, relatedEntityType, relatedEntityId, message)
                 VALUES ($1::uuid, 'TamperAlert', 'Expense', $2::uuid, $3)`,
                [id, expense.expenseid, message]
            );
        }
        await runQuery("UPDATE tamper_alerts SET notifiedSysAdmin = TRUE WHERE alertID = $1::uuid", [
            ins.rows[0].alertid,
        ]);
    } catch (e) {
        // Alert is already saved; notifiedSysAdmin stays FALSE so the gap is visible.
        console.error("Tamper notification failed:", e.message);
    }
    return { created: true, alertId: ins.rows[0].alertid };
}

function httpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

/**
 * Marks an alert as reviewed. The alert stays on record with who, when and
 * why; the expense keeps its "changed after approval" status. Rules:
 *   - a reason is required;
 *   - whoever approved the expense can't review its alert (separation of duties);
 *   - a resolution can't be changed afterwards (also enforced by a DB trigger);
 *   - every other System Administrator and General Manager is notified.
 */
async function resolveTamperAlert({ alertId, user, note }, deps = {}) {
    const runQuery = deps.query || defaultQuery;
    const reason = typeof note === "string" ? note.trim() : "";
    if (reason.length < 10) throw httpError(400, "Explain what you found (at least 10 characters)");
    if (reason.length > 1000) throw httpError(400, "The explanation is too long (1000 characters max)");

    const found = await runQuery(
        `SELECT ta.alertid, ta.resolvedat, e.expenseid, e.approvedby, e.vendorname, e.amount, e.projectid
           FROM tamper_alerts ta JOIN Expenses e ON e.expenseid = ta.expenseid
          WHERE ta.alertID = $1::uuid`,
        [alertId]
    );
    if (found.rowCount === 0) throw httpError(404, "Alert not found");
    const alert = found.rows[0];
    if (alert.resolvedat) throw httpError(409, "This alert was already reviewed");
    if (alert.approvedby && alert.approvedby === user.id) {
        throw httpError(403, "You approved this expense, so someone else must review its alert");
    }

    const updated = await runQuery(
        `UPDATE tamper_alerts
            SET resolvedAt = NOW(), resolvedBy = $2::uuid, resolutionNote = $3
          WHERE alertID = $1::uuid AND resolvedAt IS NULL
          RETURNING *`,
        [alertId, user.id, reason]
    );
    if (updated.rowCount === 0) throw httpError(409, "This alert was already reviewed");

    const message = `${user.name || "A user"} (${user.role}) marked the tamper alert for "${alert.vendorname}" (${money(alert)}) as reviewed: ${reason}`;
    for (const id of await alertRecipients(runQuery, alert.projectid, user.id)) {
        await runQuery(
            `INSERT INTO notifications (recipientId, type, relatedEntityType, relatedEntityId, message)
             VALUES ($1::uuid, 'TamperAlert', 'Expense', $2::uuid, $3)`,
            [id, alert.expenseid, message]
        );
    }
    return updated.rows[0];
}

module.exports = { raiseTamperAlert, resolveTamperAlert, tamperMessage, alertRecipients };
