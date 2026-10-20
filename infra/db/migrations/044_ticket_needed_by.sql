-- 044_ticket_needed_by.sql
-- Optional "needed by" date on procurement tickets (Material Request / Work Item).
--
-- The Site Manager may say when the material is needed; the Project Manager can
-- change it when acknowledging the ticket. The Purchaser's Requests list uses it
-- to show urgency (Overdue / Needed today / Due soon) and to sort by due date.
-- Nullable: older tickets, Report tickets and requests with no date have none.
--
-- Safe to re-run.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS neededBy DATE NULL;
