-- F12: pending blockchain records must reach the Geth nodes within 72 hours
-- of approval (CAP1 Table 51).
--
--   approvedAt         when the expense was approved (starts the 72-hour clock)
--   blockchainOverdueAt when the system noticed the 72 hours had passed with
--                       the record still not on the chain (set once, so the
--                       alert is sent once, not every minute)
--
-- Safe to run twice.

ALTER TABLE Expenses ADD COLUMN IF NOT EXISTS approvedAt TIMESTAMP;
ALTER TABLE Expenses ADD COLUMN IF NOT EXISTS blockchainOverdueAt TIMESTAMP;

-- Expenses approved before this migration: the best record of the approval
-- time is the chain log when there is one. If there is no log, the real
-- approval time is unknown (submittedAt is NOT the approval time and could
-- trigger a false overdue alert), so the 72-hour clock starts at migration
-- time instead (grace period).
UPDATE Expenses e
   SET approvedAt = COALESCE(
         (SELECT MIN(bl.timestamp) FROM BlockchainLogs bl
           WHERE bl.expenseID = e.expenseID AND bl.eventType = 'ExpenseApproved'),
         NOW())
 WHERE e.status = 'Approved' AND e.approvedAt IS NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_blockchain_pending
  ON Expenses (approvedAt)
  WHERE blockchainStatus = 'Pending' AND status = 'Approved';

-- New notification type for the overdue alert (keeps every existing type).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'ScheduleVarianceAlert', 'ExpenseRejected', 'TamperAlert', 'TaskAssigned',
    'ProjectAssigned', 'ProjectActivated', 'BOMApproved', 'BOMReopened',
    'TicketSubmitted', 'TicketAcknowledged', 'TicketResolved', 'TicketRejected',
    'TaskAcknowledged', 'TaskFlagged',
    'CheckinIssue', 'CheckinFlagged',
    'BlockchainOverdue'
  ));
