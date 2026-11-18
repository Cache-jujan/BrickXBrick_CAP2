-- 067_project_completed_and_unassigned_notifications.sql
--
-- Two new notification types:
--   ProjectCompleted   completing a project now notifies the people on it (its
--                      Project Manager, Site Manager and every active Purchaser),
--                      as activating, suspending and terminating already do.
--   ProjectUnassigned  a Project Manager or Site Manager taken off a project is
--                      told (the new one already gets ProjectAssigned).
--
-- The list repeats every value allowed today (060), then adds the new ones.
-- Existing rows are untouched. Safe to run twice.
--
-- Until this is run, completing and reassigning still work: these notices are
-- sent after the change is saved and a failed notice is only logged.

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
    'ExpenseResubmitted', 'TaskSubmitted',
    'ProjectCompleted', 'ProjectUnassigned'
  ));
