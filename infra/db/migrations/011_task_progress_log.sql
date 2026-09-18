-- infra/db/migrations/010_task_progress_log.sql
--
-- F5: task progress submission is a two-phase, PM-reviewed flow, not a
-- direct write. Tasks are binary WBS leaf items (no partial %) -- SM marks
-- one done with required photo evidence, and it sits as Pending Review
-- until the PM Acknowledges (task flips to Completed, milestone
-- recalculates via the existing F3 recalcMilestoneProgress) or Flags it
-- (SM must resubmit; prior pending entry becomes Superseded, not blocked).
--
-- clientSubmissionId is the idempotency key for F10 offline replay --
-- generated on-device at submit time, carried through the offline queue,
-- unique here so a retried/duplicated sync call returns the existing row
-- instead of creating a second submission. Same check-then-insert shape
-- already proven in sync_test_records (006_sync_spike.sql). CONFIRM exact
-- field name / generation point with Jan before F10 wires against this --
-- placeholder contract until then.
--
-- tasks.issueReport is NOT written by this flow anymore -- SM issue
-- reports now go through the ticket system (see Report ticketType below).
-- Column is left in place (not dropped) since nothing else references
-- removing it yet; flag for cleanup once F10/F9 confirm nothing else reads it.

CREATE TABLE task_progress_log (
    logId               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    taskId              UUID NOT NULL REFERENCES tasks(taskId),
    submittedBy         UUID NOT NULL REFERENCES users(userId),
    clientSubmissionId  UUID NOT NULL UNIQUE,
    photoEvidenceURL    TEXT NOT NULL,
    note                TEXT NULL,
    reviewStatus        VARCHAR(20) NOT NULL DEFAULT 'Pending Review'
                           CHECK (reviewStatus IN ('Pending Review', 'Acknowledged', 'Flagged', 'Superseded')),
    reviewedBy          UUID NULL REFERENCES users(userId),
    reviewedAt          TIMESTAMP NULL,
    reviewReason        TEXT NULL,
    createdAt           TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Report: SM-initiated via the existing POST /api/tickets, PM-resolved
-- directly (no Purchaser step) -- see routes/tickets.js Report branch.
ALTER TABLE Tickets DROP CONSTRAINT tickets_tickettype_check;
ALTER TABLE Tickets ADD CONSTRAINT tickets_tickettype_check
  CHECK (ticketType IN ('Material Request', 'Work Item', 'Report'));