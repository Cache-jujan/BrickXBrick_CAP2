-- Notifications: one CHECK that allows every type, old and new.
--
-- Two branches each replaced notifications_type_check with their own list:
--   049_blockchain_72h_rule.sql            added BlockchainOverdue
--   049_expense_approved_notification.sql  added ExpenseApproved
-- Each list was written without the other's type, so whichever ran last would have
-- dropped the other type and its inserts would fail the constraint. This migration
-- runs after both and allows all of them. Safe to run twice.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'ScheduleVarianceAlert', 'ExpenseRejected', 'TamperAlert', 'TaskAssigned',
    'ProjectAssigned', 'ProjectActivated', 'BOMApproved', 'BOMReopened',
    'TicketSubmitted', 'TicketAcknowledged', 'TicketResolved', 'TicketRejected',
    'TaskAcknowledged', 'TaskFlagged',
    'CheckinIssue', 'CheckinFlagged',
    'BlockchainOverdue', 'ExpenseApproved'
  ));
