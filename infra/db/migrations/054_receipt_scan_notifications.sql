-- Notifications for background receipt scans: tell the owner when a scan is
-- Ready (or Failed) so they can leave the page and still find out.
--
-- Two CHECKs are widened. Both lists repeat every value allowed today
-- (051 for type, 048 for relatedEntityType), then add the new ones. Safe to run twice.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'ScheduleVarianceAlert', 'ExpenseRejected', 'TamperAlert', 'TaskAssigned',
    'ProjectAssigned', 'ProjectActivated', 'BOMApproved', 'BOMReopened',
    'TicketSubmitted', 'TicketAcknowledged', 'TicketResolved', 'TicketRejected',
    'TaskAcknowledged', 'TaskFlagged',
    'CheckinIssue', 'CheckinFlagged',
    'BlockchainOverdue', 'ExpenseApproved',
    'ReceiptScanReady', 'ReceiptScanFailed'
  ));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_relatedentitytype_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_relatedentitytype_check
  CHECK (relatedEntityType IN ('Milestone', 'Task', 'Expense', 'Project', 'Ticket', 'Checkin', 'ReceiptScan'));
