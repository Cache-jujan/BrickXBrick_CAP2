-- Migration 014 accidentally removed TamperAlert.
-- Restore it without modifying an already-applied migration.

ALTER TABLE notifications
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
ADD CONSTRAINT notifications_type_check
CHECK (
  type IN (
    'ScheduleVarianceAlert',
    'ExpenseRejected',
    'TamperAlert'
  )
);
