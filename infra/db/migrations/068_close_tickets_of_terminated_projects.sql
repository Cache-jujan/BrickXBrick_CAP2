-- 067_close_tickets_of_terminated_projects.sql
-- Terminating a project now rejects its open, unbought Material Requests
-- (backend/src/lib/projectClosure.js). This closes the same requests on projects
-- that were cancelled or archived before that rule existed.
--
-- A request already partly bought is left alone. Tickets are never deleted.
-- The transition log needs a user: the oldest General Manager stands in, because
-- the original actor was not recorded. Safe to re-run: closed tickets no longer match.

WITH closing AS (
    SELECT t.ticketId, t.status AS fromStatus
      FROM tickets t
      JOIN projects p ON p.projectId = t.projectId
     WHERE p.status IN ('Cancelled', 'Archived')
       AND t.ticketType = 'Material Request'
       AND (
            t.status = 'Pending'
            OR (t.status = 'Acknowledged'
                AND NOT EXISTS (SELECT 1 FROM expenses e
                                 WHERE e.ticketId = t.ticketId AND e.status <> 'Rejected'))
       )
),
actor AS (
    SELECT userId FROM users WHERE role = 'General Manager' ORDER BY createdAt LIMIT 1
),
closed AS (
    UPDATE tickets t
       SET status = 'Rejected', resolvedAt = NOW(), updatedAt = NOW(),
           rejectionReason = 'Auto-cancelled: project terminated'
      FROM closing c
     WHERE t.ticketId = c.ticketId
    RETURNING t.ticketId
)
INSERT INTO ticket_status_transitions (ticketId, fromStatus, toStatus, changedBy)
SELECT c.ticketId, c.fromStatus, 'Rejected', (SELECT userId FROM actor)
  FROM closing c
 WHERE EXISTS (SELECT 1 FROM actor);
