// projectClosure.js: what happens to open requests when a project is terminated.
//
// Tickets are never deleted (expenses, allocations and the audit trail point at
// them). Open requests that nobody has bought anything for are moved to Rejected
// with an explanatory reason, and each move is written to the transition log.
// A request that is already partly bought is left alone: the money spent on it
// stays visible, and the pickers hide it because its project is no longer Active.

const AUTO_CANCEL_REASON = "Auto-cancelled: project terminated";

const OPEN_UNBOUGHT_TICKETS = `
  SELECT t.ticketId, t.status
    FROM tickets t
   WHERE t.projectId = $1
     AND t.ticketType = 'Material Request'
     AND (
       t.status = 'Pending'
       OR (t.status = 'Acknowledged'
           AND NOT EXISTS (SELECT 1 FROM expenses e
                            WHERE e.ticketId = t.ticketId AND e.status <> 'Rejected'))
     )
   FOR UPDATE OF t`;

/**
 * Rejects the open, unbought Material Requests of a project.
 * Runs on the caller's transaction client. Returns the number of tickets closed.
 * `changedBy` is the user who terminated the project.
 */
async function closeOpenTicketsForProject(client, projectId, changedBy) {
  const open = await client.query(OPEN_UNBOUGHT_TICKETS, [projectId]);
  for (const row of open.rows) {
    await client.query(
      `UPDATE tickets
          SET status = 'Rejected', resolvedBy = $2, resolvedAt = NOW(), updatedAt = NOW(),
              rejectionReason = $3
        WHERE ticketId = $1`,
      [row.ticketid, changedBy, AUTO_CANCEL_REASON]
    );
    await client.query(
      `INSERT INTO ticket_status_transitions (ticketId, fromStatus, toStatus, changedBy)
       VALUES ($1, $2, 'Rejected', $3)`,
      [row.ticketid, row.status, changedBy]
    );
  }
  return open.rowCount;
}

module.exports = { closeOpenTicketsForProject, AUTO_CANCEL_REASON };
