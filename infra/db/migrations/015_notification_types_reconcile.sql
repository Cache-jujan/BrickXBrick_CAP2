ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('ScheduleVarianceAlert', 'ExpenseRejected', 'TamperAlert'));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_relatedentitytype_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_relatedentitytype_check
  CHECK (relatedEntityType IN ('Milestone', 'Task', 'Expense'));