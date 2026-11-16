-- 058_reopen_partly_bought_requests.sql
--
-- A Purchaser's request used to be marked Resolved by their FIRST receipt, even when only part of
-- the quantity was bought, so the rest of it dropped off their To Buy list. A request now stays
-- Acknowledged until a purchase brings what is left to 0 (or it is closed short).
--
-- This puts the requests that were resolved too early back to Acknowledged:
--   * Material Requests resolved by their assigned Purchaser (not a Site Manager),
--   * not closed short on purpose (closedShortReason is empty),
--   * with quantity still left, established from material-level receipt lines.
-- Stored lineitems.bomItemID or an exact normalized material name establishes the link.
-- Do not infer historical material quantities from expenses.quantity (it may include fees
-- and other materials). Leave a ticket unchanged if any receipt has no matching lines or
-- a matching line lacks a non-negative numeric quantity; it needs manual review.
-- Each one gets an audit row in ticket_status_transitions. Safe to run twice: after the first
-- run nothing matches. No notifications are sent.

WITH receipt_quantities AS (
  SELECT e.ticketID,
         SUM(CASE WHEN jsonb_typeof(item->'quantity') = 'number'
                  THEN CASE WHEN (item->>'quantity')::numeric >= 0
                            THEN (item->>'quantity')::numeric END END) AS quantity,
         BOOL_AND(CASE WHEN jsonb_typeof(item->'quantity') = 'number'
                       THEN (item->>'quantity')::numeric >= 0 ELSE FALSE END) AS known
    FROM expenses e
    JOIN tickets t ON t.ticketID = e.ticketID
    LEFT JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(e.lineitems) = 'array' THEN e.lineitems ELSE '[]'::jsonb END
    ) item ON (
      (t.bomItemID IS NOT NULL AND item->>'bomItemID' = t.bomItemID::text)
      OR (NULLIF(item->>'bomItemID', '') IS NULL
          AND NULLIF(lower(regexp_replace(trim(t.materialType), '\s+', ' ', 'g')), '') =
              lower(regexp_replace(trim(item->>'description'), '\s+', ' ', 'g')))
    )
   WHERE e.status <> 'Rejected'
   GROUP BY e.expenseID, e.ticketID
), reopened AS (
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
     AND NOT EXISTS (SELECT 1 FROM receipt_quantities r
                      WHERE r.ticketID = t.ticketID AND NOT r.known)
     AND t.quantity - COALESCE((SELECT SUM(r.quantity) FROM receipt_quantities r
                                 WHERE r.ticketID = t.ticketID), 0) > 0
  RETURNING t.ticketID, t.assignedTo
)
INSERT INTO ticket_status_transitions (ticketId, fromStatus, toStatus, changedBy)
SELECT ticketID, 'Resolved', 'Acknowledged', assignedTo FROM reopened;
