-- 060_resubmit_and_task_notifications.sql
--
-- Two new notifications for the Project Manager:
--   ExpenseResubmitted  a Purchaser fixed and resubmitted a rejected expense.
--   TaskSubmitted       a Site Manager sent a task photo for review.
--
-- The list repeats every value allowed today (057), then adds the two new
-- ones. relatedEntityType is unchanged: both use 'Expense' and 'Task', which
-- are already allowed. Existing rows are untouched. Safe to run twice.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'ScheduleVarianceAlert', 'ExpenseRejected', 'TamperAlert', 'TaskAssigned',
    'ProjectAssigned', 'ProjectActivated', 'BOMApproved', 'BOMReopened',
    'TicketSubmitted', 'TicketAcknowledged', 'TicketResolved', 'TicketRejected',
    'TaskAcknowledged', 'TaskFlagged',
    'CheckinIssue', 'CheckinFlagged',
    'BlockchainOverdue', 'ExpenseApproved',
    'ReceiptScanReady', 'ReceiptScanFailed',
    'ProjectSuspended', 'ProjectResumed',
    'ProjectTerminated',
    'ExpenseResubmitted', 'TaskSubmitted'
  ));
