ALTER TABLE Expenses ADD COLUMN rejectionReason TEXT;

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('ScheduleVarianceAlert', 'ExpenseRejected'));

ALTER TABLE notifications DROP CONSTRAINT notifications_relatedentitytype_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_relatedentitytype_check
  CHECK (relatedEntityType IN ('Milestone', 'Task', 'Expense'));