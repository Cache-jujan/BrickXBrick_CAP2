const { query } = require("./db");

async function raiseTamperAlert(expense, recomputedHash, onChainHash, reason) {
    // One open alert per expense, so repeated Verify clicks don't pile up rows.
    const open = await query(
        "SELECT alertID FROM tamper_alerts WHERE expenseID = $1 AND resolvedAt IS NULL",
        [expense.expenseid]
    );
    if (open.rowCount > 0) return { created: false };

    const ins = await query(
        `INSERT INTO tamper_alerts (expenseID, recomputedHash, onChainHash)
         VALUES ($1, $2, $3) RETURNING alertid`,
        [expense.expenseid, recomputedHash, onChainHash || "MISSING"]
    );
    await query(
        "UPDATE Expenses SET blockchainStatus = 'TamperDetected' WHERE expenseID = $1",
        [expense.expenseid]
    );

    const message = `Tamper detected: expense "${expense.vendorname}" (₱${expense.amount}) — ${reason}.`;
    try {
        const admins = await query(
            "SELECT userid FROM users WHERE role = 'System Administrator' AND status = 'Active'"
        );
        const recipients = admins.rows.map((a) => a.userid);

        const proj = await query("SELECT createdby FROM projects WHERE projectid = $1", [expense.projectid]);
        if (proj.rowCount > 0) recipients.push(proj.rows[0].createdby);

        for (const id of recipients) {
            await query(
                `INSERT INTO notifications (recipientId, type, relatedEntityType, relatedEntityId, message)
                 VALUES ($1, 'TamperAlert', 'Expense', $2, $3)`,
                [id, expense.expenseid, message]
            );
        }
        await query(
            "UPDATE tamper_alerts SET notifiedSysAdmin = TRUE WHERE alertID = $1",
            [ins.rows[0].alertid]
        );
    } catch (e) {
        // Alert is already saved; notifiedSysAdmin stays FALSE so the gap is visible.
        console.error("Tamper notification failed:", e.message);
    }
    return { created: true };
}

module.exports = { raiseTamperAlert };