-- 048_daily_checkins.sql
-- Daily progress check-ins: the Site Manager reports three times a day
-- (Morning, Midday, End of day) on each Active project they run.
--
-- A check-in is a report about the PROJECT. It may point at tasks, but it never
-- changes a task, a milestone, progress, or the task photo review flow
-- (task_progress_log). Those still move only through the existing flow.
--
-- The Project Manager reads the check-ins and may Acknowledge or Flag one with a
-- comment. A Flag is a comment for the Site Manager, not a request to resubmit.
--
-- Idempotency: clientSubmissionId (made on the phone) is UNIQUE, and a Site
-- Manager can have only one check-in per project, day and slot, so a retried or
-- replayed sync can never create a second one.
--
-- Slot times are settings, not code (Philippine time, 24-hour "HH:MM-HH:MM").
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS daily_progress_checkins (
  checkinId          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clientSubmissionId UUID NOT NULL UNIQUE,
  projectId          UUID NOT NULL REFERENCES projects(projectId),
  submittedBy        UUID NOT NULL REFERENCES users(userId),
  -- The Philippine calendar day the check-in was made, taken from capturedAt.
  checkinDate        DATE NOT NULL,
  slot               VARCHAR(10) NOT NULL CHECK (slot IN ('Morning', 'Midday', 'EndOfDay')),
  -- When the Site Manager filled it in on the phone (may be earlier than submittedAt).
  capturedAt         TIMESTAMP NOT NULL,
  submittedAt        TIMESTAMP NOT NULL DEFAULT NOW(),
  siteStatus         VARCHAR(10) NOT NULL CHECK (siteStatus IN ('On Track', 'Delayed', 'Blocked')),
  summary            TEXT NOT NULL CHECK (char_length(btrim(summary)) BETWEEN 1 AND 2000),
  issues             TEXT NULL CHECK (issues IS NULL OR char_length(issues) <= 2000),
  needsPmAction      BOOLEAN NOT NULL DEFAULT FALSE,
  -- Filled in inside the slot's time window? (false = entered late or early)
  onTime             BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT daily_checkins_issue_text_check CHECK (needsPmAction = FALSE OR issues IS NOT NULL),
  CONSTRAINT daily_checkins_one_per_slot UNIQUE (projectId, checkinDate, slot, submittedBy)
);

CREATE INDEX IF NOT EXISTS idx_daily_checkins_project_date ON daily_progress_checkins (projectId, checkinDate DESC);
CREATE INDEX IF NOT EXISTS idx_daily_checkins_submitter ON daily_progress_checkins (submittedBy, checkinDate DESC);

CREATE TABLE IF NOT EXISTS daily_checkin_photos (
  photoId    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkinId  UUID NOT NULL REFERENCES daily_progress_checkins(checkinId) ON DELETE CASCADE,
  photoUrl   TEXT NOT NULL,
  sortOrder  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_daily_checkin_photos_checkin ON daily_checkin_photos (checkinId);

-- Optional: the tasks a check-in is about. Reference only; no task is changed.
CREATE TABLE IF NOT EXISTS daily_checkin_tasks (
  checkinId UUID NOT NULL REFERENCES daily_progress_checkins(checkinId) ON DELETE CASCADE,
  taskId    UUID NOT NULL REFERENCES tasks(taskId),
  PRIMARY KEY (checkinId, taskId)
);

-- The Project Manager's response. One per check-in; a later review replaces it.
CREATE TABLE IF NOT EXISTS daily_progress_reviews (
  reviewId    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkinId   UUID NOT NULL UNIQUE REFERENCES daily_progress_checkins(checkinId) ON DELETE CASCADE,
  reviewedBy  UUID NOT NULL REFERENCES users(userId),
  decision    VARCHAR(12) NOT NULL CHECK (decision IN ('Acknowledged', 'Flagged')),
  comment     TEXT NULL CHECK (comment IS NULL OR char_length(comment) <= 500),
  reviewedAt  TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_reviews_flag_comment_check
    CHECK (decision <> 'Flagged' OR (comment IS NOT NULL AND char_length(btrim(comment)) > 0))
);

-- Slot windows, Philippine time. A check-in made outside its window is still
-- accepted; it is marked as not on time.
INSERT INTO system_settings (settingKey, settingValue, description) VALUES
  ('checkin_window_morning', '05:00-10:00',
   'Morning check-in window (Philippine time, HH:MM-HH:MM).'),
  ('checkin_window_midday', '10:00-14:00',
   'Midday check-in window (Philippine time, HH:MM-HH:MM).'),
  ('checkin_window_endofday', '14:00-21:00',
   'End-of-day check-in window (Philippine time, HH:MM-HH:MM).')
ON CONFLICT (settingKey) DO NOTHING;

-- Notifications. Two new types and one new entity type; every earlier value is kept.
--   CheckinIssue    -> the Project Manager: a Site Manager marked a check-in as needing action
--   CheckinFlagged  -> the Site Manager: the Project Manager flagged a check-in, with a comment
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'ScheduleVarianceAlert', 'ExpenseRejected', 'TamperAlert', 'TaskAssigned',
    'ProjectAssigned', 'ProjectActivated', 'BOMApproved', 'BOMReopened',
    'TicketSubmitted', 'TicketAcknowledged', 'TicketResolved', 'TicketRejected',
    'TaskAcknowledged', 'TaskFlagged',
    'CheckinIssue', 'CheckinFlagged'
  ));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_relatedentitytype_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_relatedentitytype_check
  CHECK (relatedEntityType IN ('Milestone', 'Task', 'Expense', 'Project', 'Ticket', 'Checkin'));
