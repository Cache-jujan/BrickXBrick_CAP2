-- Widens the notifications CHECK constraints to allow blockchain
-- tamper-alert notifications, in addition to the existing
-- ScheduleVarianceAlert (Milestone/Task) type.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('ScheduleVarianceAlert', 'TamperAlert'));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_relatedentitytype_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_relatedentitytype_check
  CHECK (relatedEntityType IN ('Milestone', 'Task', 'Expense'));