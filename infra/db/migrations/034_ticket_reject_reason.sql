-- 032_ticket_rejection_reason.sql
-- Stores why a ticket was rejected, so the Site Manager can see what to fix.
--
-- The Project Manager rejects a Pending ticket (and the assigned Purchaser an
-- Acknowledged one) with a reason. Nullable because rows rejected before this
-- migration — and every non-rejected ticket — have none. Mirrors the existing
-- Expenses.rejectionReason (migration 015).
--
-- Safe to re-run.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS rejectionReason TEXT NULL;