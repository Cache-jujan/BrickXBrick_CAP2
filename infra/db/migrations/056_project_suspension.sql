-- 056_project_suspension.sql
--
-- Project suspension (client: a project can be put on hold and resumed later,
-- for example when the client delays payment or the weather stops work).
--
--   projects.status gains 'Suspended'. Active <-> Suspended; a Suspended project
--   can also be cancelled ("terminated").
--   suspendedAt, suspensionReason, expectedResumeDate describe the current hold.
--   They are cleared on resume; the history stays in project_status_log.
--   project_status_log records every hold and resume: who, when, why.
--   Two notification types: ProjectSuspended, ProjectResumed.
--
-- Existing rows are untouched. The notification list repeats every value allowed
-- today (054), then adds the two new ones. Safe to run twice.

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check
  CHECK (status IN ('Draft', 'Active', 'Suspended', 'Completed', 'Cancelled', 'Archived'));

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS suspendedAt         TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS suspensionReason    TEXT      NULL,
  ADD COLUMN IF NOT EXISTS expectedResumeDate  DATE      NULL;

CREATE TABLE IF NOT EXISTS project_status_log (
  logId               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  projectId           UUID NOT NULL REFERENCES projects(projectId) ON DELETE CASCADE,
  fromStatus          VARCHAR(20) NOT NULL,
  toStatus            VARCHAR(20) NOT NULL,
  reason              TEXT NULL,
  expectedResumeDate  DATE NULL,
  changedBy           UUID NULL REFERENCES users(userId),
  changedAt           TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_status_log_project ON project_status_log (projectId, changedAt DESC);

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
    'ProjectSuspended', 'ProjectResumed'
  ));
