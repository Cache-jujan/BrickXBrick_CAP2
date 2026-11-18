-- 063_budget_adjustment_tickets.sql
-- A Purchaser who cannot buy because a request is over its approved budget can send the Project Manager a
-- "Budget Adjustment" ticket: how much more is needed and why (a reason from a fixed list, plus an optional note).
-- The PM approves (the request's approved budget goes up by that amount) or rejects it with a reason.
--
-- It is an ordinary row in tickets, linked to the Material Request it is about, so it shows in the PM's ticket
-- queue and uses the same status history and notifications. It goes Pending -> Resolved (approved) or Rejected,
-- like a Report: there is no Acknowledged step. The Material Request's own states are not touched.
--
--   parentTicketId    the Material Request that needs more budget
--   requestedAmount   the extra pesos asked for
--   adjustmentReason  the reason code the Purchaser tapped (the app turns it into words)
--   previousBudget / newBudget   the request's approved budget before and after an approval (audit)
--
-- Safe to re-run.

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_tickettype_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_tickettype_check
  CHECK (ticketType IN ('Material Request', 'Work Item', 'Report', 'Budget Adjustment'));

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS parentTicketId   UUID NULL REFERENCES tickets(ticketId),
  ADD COLUMN IF NOT EXISTS requestedAmount  DECIMAL(12,2) NULL,
  ADD COLUMN IF NOT EXISTS adjustmentReason VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS previousBudget   DECIMAL(12,2) NULL,
  ADD COLUMN IF NOT EXISTS newBudget        DECIMAL(12,2) NULL;

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_requested_amount_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_requested_amount_check
  CHECK (requestedAmount IS NULL OR requestedAmount > 0);

-- One open adjustment per request at a time, so the PM never sees the same ask twice.
CREATE UNIQUE INDEX IF NOT EXISTS tickets_one_pending_adjustment
  ON tickets (parentTicketId)
  WHERE ticketType = 'Budget Adjustment' AND status = 'Pending';
