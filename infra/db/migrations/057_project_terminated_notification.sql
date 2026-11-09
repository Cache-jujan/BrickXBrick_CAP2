-- 057_project_terminated_notification.sql
--
-- A project that is terminated (or cancelled while still a Draft) now notifies
-- the people on it. One new notification type: ProjectTerminated.
--
-- The list repeats every value allowed today (056), then adds the new one.
-- Existing rows are untouched. Safe to run twice.

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
    'ProjectTerminated'
  ));
