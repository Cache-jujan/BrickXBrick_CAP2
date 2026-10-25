// F12: the 72-hour rule. A pending blockchain record must reach the Geth
// nodes within 72 hours of approval (CAP1 Table 51). Pending records are
// retried every minute and are never dropped; this only notices when one has
// waited too long and tells the people who can act on it.
const { query: defaultQuery } = require("./db");

const OVERDUE_HOURS = 72;

function overdueMessage(expense) {
    return `The tamper-proof copy of "${expense.vendorname}" is still waiting to be saved, more than ${OVERDUE_HOURS} hours after approval. Please check that the blockchain nodes are online.`;
}

// Every active System Administrator and General Manager.
async function overdueRecipients(runQuery) {
    const r = await runQuery(
        `SELECT userid FROM users
          WHERE status = 'Active' AND role IN ('System Administrator', 'General Manager')`
    );
    return r.rows.map((row) => row.userid).filter(Boolean);
}

/**
 * Finds approved expenses still waiting for the chain more than 72 hours after
 * approval, marks each one (so it is reported once) and notifies the GMs and
 * System Administrators. Returns how many were newly marked.
 */
async function flagOverduePending(deps = {}) {
    const runQuery = deps.query || defaultQuery;
    const hours = deps.hours || OVERDUE_HOURS;
    const found = await runQuery(
        `SELECT e.expenseid, e.vendorname
           FROM Expenses e
          WHERE e.blockchainStatus = 'Pending' AND e.status = 'Approved'
            AND e.approvedAt IS NOT NULL
            AND e.approvedAt < NOW() - ($1::int * INTERVAL '1 hour')
            AND e.blockchainOverdueAt IS NULL
            AND NOT EXISTS (SELECT 1 FROM BlockchainLogs bl
                             WHERE bl.expenseID = e.expenseID AND bl.eventType = 'ExpenseApproved')
          ORDER BY e.approvedAt
          LIMIT 50`,
        [hours]
    );
    if (found.rowCount === 0) return 0;

    const recipients = await overdueRecipients(runQuery);
    let flagged = 0;
    for (const expense of found.rows) {
        // Mark first; the AND ... IS NULL makes a second server instance skip it.
        const marked = await runQuery(
            `UPDATE Expenses SET blockchainOverdueAt = NOW()
              WHERE expenseID = $1 AND blockchainOverdueAt IS NULL`,
            [expense.expenseid]
        );
        if (marked.rowCount === 0) continue;
        flagged += 1;
        console.log(`Blockchain record for expense ${expense.expenseid} is past the ${hours}-hour limit`);
        for (const id of recipients) {
            await runQuery(
                `INSERT INTO notifications (recipientId, type, relatedEntityType, relatedEntityId, message)
                 VALUES ($1::uuid, 'BlockchainOverdue', 'Expense', $2::uuid, $3)`,
                [id, expense.expenseid, overdueMessage(expense)]
            );
        }
    }
    return flagged;
}

module.exports = { flagOverduePending, OVERDUE_HOURS };
