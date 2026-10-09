-- D-06: two concurrent POST /:id/progress calls for the same task could
-- each supersede-then-insert against a stale view of task_progress_log,
-- leaving two Pending Review rows for one task. The application now also
-- locks the task row (SELECT ... FOR UPDATE) before that sequence, but this
-- index is the DB-level backstop: at most one Pending Review row per task,
-- enforced even if two connections somehow race past the lock.

CREATE UNIQUE INDEX IF NOT EXISTS task_progress_log_one_pending_per_task
  ON task_progress_log (taskId)
  WHERE reviewStatus = 'Pending Review';
