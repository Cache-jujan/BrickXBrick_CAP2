// F1: the counts shown at the top of the System Administrator's page.
// Everything here is read-only and comes from tables the app already has.
const { query: defaultQuery } = require("./db");

async function loadAdminOverview(deps = {}) {
    const runQuery = deps.query || defaultQuery;

    const totals = await runQuery(
        `SELECT
           (SELECT COUNT(*)::int FROM Users WHERE status = 'Active')   AS active,
           (SELECT COUNT(*)::int FROM Users WHERE status = 'Inactive') AS inactive,
           (SELECT COUNT(*)::int FROM Users WHERE lockoutUntil IS NOT NULL AND lockoutUntil > NOW()) AS locked,
           (SELECT COUNT(*)::int FROM tamper_alerts WHERE resolvedAt IS NULL) AS open_alerts,
           (SELECT COUNT(*)::int FROM Expenses
             WHERE blockchainStatus = 'Pending' AND status = 'Approved') AS pending_chain,
           (SELECT COUNT(*)::int FROM Expenses
             WHERE blockchainStatus = 'Pending' AND status = 'Approved'
               AND approvedAt IS NOT NULL AND approvedAt < NOW() - INTERVAL '72 hours') AS overdue_chain`
    );
    const byRole = await runQuery(
        `SELECT role, COUNT(*)::int AS count FROM Users WHERE status = 'Active' GROUP BY role`
    );

    const row = totals.rows[0] || {};
    return {
        active: row.active || 0,
        inactive: row.inactive || 0,
        locked: row.locked || 0,
        openTamperAlerts: row.open_alerts || 0,
        pendingBlockchain: row.pending_chain || 0,
        overdueBlockchain: row.overdue_chain || 0,
        byRole: Object.fromEntries(byRole.rows.map((r) => [r.role, r.count])),
    };
}

module.exports = { loadAdminOverview };
