-- 009_milestones.sql
-- Matches Data Dictionary Table 31 (Milestones).
-- Owned by F3 (Milestone & Task Management) - not an F6-F8 dependency,
-- but included so the full 10-table schema stands.
--
-- Numbered 009 (not 004) because 004-008 were already assigned. Order is
-- still safe: migrate.js sorts by filename, and this table's only FK
-- targets are projects (003) and users (002), both of which run earlier.
--
-- created_by is constrained to a ProjectManager at the application layer
-- (F3), not by a DB constraint - Postgres can't cheaply enforce "the role
-- of the referenced user must be X" without a trigger.

CREATE TABLE IF NOT EXISTS milestones (
    milestone_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id             UUID NOT NULL REFERENCES projects(project_id),
    created_by             UUID NOT NULL REFERENCES users(user_id),
    name                   VARCHAR(150) NOT NULL,
    due_date               DATE NOT NULL,
    completion_percentage  DECIMAL(5,2) NOT NULL DEFAULT 0
        CHECK (completion_percentage >= 0 AND completion_percentage <= 100),
    status                 VARCHAR(30) NOT NULL DEFAULT 'OnTrack'
        CHECK (status IN ('OnTrack', 'AtRisk', 'Overdue', 'Completed')),
    completed_at           TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_milestones_project_id ON milestones(project_id);