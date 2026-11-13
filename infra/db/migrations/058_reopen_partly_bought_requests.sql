-- 058_reopen_partly_bought_requests.sql
--
-- A Purchaser's request used to be marked Resolved by their FIRST receipt, even when only part of
-- the quantity was bought, so the rest of it dropped off their To Buy list. A request now stays
-- Acknowledged until a purchase brings what is left to 0 (or it is closed short).
--
-- This puts the requests that were resolved too early back to Acknowledged:
--   * Material Requests resolved by their assigned Purchaser (not a Site Manager),
--   * not closed short on purpose (closedShortReason is empty),
--   * with quantity still left: quantity minus the quantity of expenses that are not Rejected.
-- Each one gets an audit row in ticket_status_transitions. Safe to run twice: after the first
-- run nothing matches. No notifications are sent.

WITH reopened AS (
  UPDATE tickets t
     SET status = 'Acknowledged',
         resolvedAt = NULL,
         resolvedBy = NULL,
         updatedAt = NOW()
    FROM users buyer
   WHERE buyer.userID = t.assignedTo
     AND buyer.role = 'Purchaser'
     AND t.status = 'Resolved'
     AND t.ticketType = 'Material Request'
     AND t.resolvedBy = t.assignedTo
     AND t.closedShortReason IS NULL
     AND t.quantity IS NOT NULL
     AND t.quantity - COALESCE((SELECT SUM(e.quantity) FROM expenses e
                                 WHERE e.ticketID = t.ticketID AND e.status <> 'Rejected'), 0) > 0
  RETURNING t.ticketID, t.assignedTo
)
INSERT INTO ticket_status_transitions (ticketId, fromStatus, toStatus, changedBy)
SELECT ticketID, 'Resolved', 'Acknowledged', assignedTo FROM reopened;
