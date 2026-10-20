-- 043_task_review_notifications.sql
-- The Site Manager is told when a Project Manager reviews their task photo:
-- TaskAcknowledged (accepted, task Completed) or TaskFlagged (needs a new
-- photo, with the reason). Keeps every existing type.
--
-- Safe to re-apply (DROP CONSTRAINT IF EXISTS).

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'ScheduleVarianceAlert', 'ExpenseRejected', 'TamperAlert', 'TaskAssigned',
    'ProjectAssigned', 'ProjectActivated', 'BOMApproved', 'BOMReopened',
    'TicketSubmitted', 'TicketAcknowledged', 'TicketResolved', 'TicketRejected',
    'TaskAcknowledged', 'TaskFlagged'
  ));
