// projectCompletion.js (F2): what is still open when a project is completed, and
// who is told once it is.
//
// Completing never waits for these: a Pending expense can still be approved or
// rejected afterwards (the cost happened before turn-over), and an open request
// simply can't be bought against any more. The General Manager is only shown
// the counts so nothing is closed by surprise.
const OPEN_TICKET_STATUSES = ["Pending", "Acknowledged"];

/** { openTickets, pendingExpenses } for one project. */
async function findOpenItems(runQuery, projectId) {
  const tickets = await runQuery(
    `SELECT COUNT(*)::int AS n FROM tickets
      WHERE projectId = $1 AND status = ANY($2::text[])`,
    [projectId, OPEN_TICKET_STATUSES]
  );
  const expenses = await runQuery(
    `SELECT COUNT(*)::int AS n FROM expenses
      WHERE projectId = $1 AND status = 'Pending'`,
    [projectId]
  );
  return {
    openTickets: tickets.rows[0]?.n || 0,
    pendingExpenses: expenses.rows[0]?.n || 0,
  };
}

/** The project's managers and every active Purchaser, without duplicates or blanks. */
async function completionRecipients(runQuery, project) {
  const recipients = new Set([project.projectmanagerid, project.sitemanagerid]);
  const purchasers = await runQuery("SELECT userid FROM users WHERE role = 'Purchaser' AND status = 'Active'");
  purchasers.rows.forEach((p) => recipients.add(p.userid));
  recipients.delete(null);
  recipients.delete(undefined);
  return [...recipients];
}

function completionMessage(project, completionDate) {
  return `"${project.name}" is completed (turned over on ${completionDate}). It no longer takes requests, purchases or check-ins.`;
}

/**
 * Tell the people on the project. Runs after the completion is saved and never
 * throws: a notice that can't be written (for example before migration 067 is
 * run) must not undo or block the completion. Returns how many were sent.
 */
async function notifyProjectCompleted(runQuery, project, completionDate, log = console) {
  let sent = 0;
  try {
    const message = completionMessage(project, completionDate);
    for (const recipientId of await completionRecipients(runQuery, project)) {
      await runQuery(
        `INSERT INTO notifications (recipientId, type, relatedEntityType, relatedEntityId, message)
         VALUES ($1, 'ProjectCompleted', 'Project', $2, $3)`,
        [recipientId, project.projectid, message]
      );
      sent += 1;
    }
  } catch (err) {
    log.error("Project completed, but its notices could not be sent:", err.message);
  }
  return sent;
}

module.exports = {
  OPEN_TICKET_STATUSES,
  findOpenItems,
  completionRecipients,
  completionMessage,
  notifyProjectCompleted,
};
