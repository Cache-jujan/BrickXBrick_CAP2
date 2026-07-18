-- 010_tasks.sql
-- Matches Data Dictionary Table 32 (Tasks).
-- Owned by F3/F5. Must run after 009_milestones.sql (FK target).
--
-- assigned_to is constrained to a SiteManager at the application layer
-- (F3/F5), not by a DB constraint.
--
-- schedule_variance_alert_sent prevents duplicate at-risk alerts from
-- firing to the Project Manager for the same task.

CREATE TABLE IF NOT EXISTS tasks (
    task_id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    milestone_id                  UUID NOT NULL REFERENCES milestones(milestone_id),
    assigned_to                   UUID NOT NULL REFERENCES users(user_id),
    updated_by                    UUID REFERENCES users(user_id),
    task_name                     VARCHAR(150) NOT NULL,
    completion_percentage         DECIMAL(5,2) NOT NULL DEFAULT 0
        CHECK (completion_percentage >= 0 AND completion_percentage <= 100),
    photo_evidence_url            TEXT,
    status                        VARCHAR(30) NOT NULL DEFAULT 'Pending'
        CHECK (status IN ('Pending', 'InProgress', 'Completed')),
    due_date                      DATE NOT NULL,
    issue_report                  TEXT,
    schedule_variance_alert_sent  BOOLEAN NOT NULL DEFAULT FALSE,
    last_updated_at               TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_milestone_id ON tasks(milestone_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);