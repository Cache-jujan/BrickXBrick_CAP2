-- D-16: a Site Manager had no way to find out a task was assigned to them
-- short of refreshing their task list. Add a TaskAssigned notification type
-- alongside the existing ScheduleVarianceAlert/ExpenseRejected/TamperAlert.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('ScheduleVarianceAlert', 'ExpenseRejected', 'TamperAlert', 'TaskAssigned'));
