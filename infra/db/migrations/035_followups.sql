-- 035_pr95_followups.sql
-- Schema for the PR #95 follow-up batch:
--   * ticket notification types + Ticket as a notification entity
--   * SM "fix & resubmit" link between a rejected ticket and its replacement
--   * milestone planning/construction phase
--   * planning tasks owned by a role (no Site Manager), markable done by the PM
--
-- Written to be safe to re-apply (IF NOT EXISTS / DROP CONSTRAINT IF EXISTS).

-- 1. Notifications: add the four ticket events, keeping every existing type.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'ScheduleVarianceAlert', 'ExpenseRejected', 'TamperAlert', 'TaskAssigned',
    'ProjectAssigned', 'ProjectActivated', 'BOMApproved', 'BOMReopened',
    'TicketSubmitted', 'TicketAcknowledged', 'TicketResolved', 'TicketRejected'
  ));

-- A notification can now point at a Ticket (used for deep-linking from the feed).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_relatedentitytype_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_relatedentitytype_check
  CHECK (relatedEntityType IN ('Milestone', 'Task', 'Expense', 'Project', 'Ticket'));

-- 2. Fix & resubmit: a new ticket may record the rejected ticket it replaces.
--    A rejected ticket can be resubmitted at most once (partial unique index).
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS resubmittedFromId UUID NULL REFERENCES tickets(ticketID);
CREATE UNIQUE INDEX IF NOT EXISTS tickets_resubmitted_from_once
  ON tickets (resubmittedFromId)
  WHERE resubmittedFromId IS NOT NULL;

-- 3. Milestones carry a phase. Existing rows default to Construction, so
--    nothing already in the system changes behaviour.
ALTER TABLE milestones
  ADD COLUMN IF NOT EXISTS phase VARCHAR(20) NOT NULL DEFAULT 'Construction';
ALTER TABLE milestones DROP CONSTRAINT IF EXISTS milestones_phase_check;
ALTER TABLE milestones ADD CONSTRAINT milestones_phase_check
  CHECK (phase IN ('Planning', 'Construction'));

-- 4. Planning tasks have no Site Manager; they are owned by a role (GM or PM)
--    and completed by the PM directly. Construction tasks are unchanged and
--    still require an assignee.
ALTER TABLE tasks ALTER COLUMN assignedTo DROP NOT NULL;
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS handledBy      VARCHAR(2) NULL,
  ADD COLUMN IF NOT EXISTS completedBy    UUID NULL REFERENCES users(userID),
  ADD COLUMN IF NOT EXISTS completedAt    TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS completionNote TEXT NULL;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_handledby_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_handledby_check
  CHECK (handledBy IS NULL OR handledBy IN ('GM', 'PM'));

-- Every task is owned somehow: a construction task by its assignee, a planning
-- task by a role. Guards against a task with neither.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_owner_present_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_owner_present_check
  CHECK (assignedTo IS NOT NULL OR handledBy IS NOT NULL);