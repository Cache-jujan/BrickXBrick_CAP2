-- 003_projects.sql
-- Matches Data Dictionary Table 30 (Projects).
-- F6 needs this for the projectID an expense links to; F2 owns the real
-- creation workflow (GM-exclusive) which is mocked here for now.

CREATE TABLE IF NOT EXISTS projects (
    project_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by   UUID NOT NULL REFERENCES users(user_id),
    name         VARCHAR(150) NOT NULL,
    description  TEXT,
    client_name  VARCHAR(150) NOT NULL,
    status       VARCHAR(30) NOT NULL DEFAULT 'Draft'
        CHECK (status IN ('Draft', 'Active', 'Completed', 'Archived')),
    start_date   DATE NOT NULL,
    end_date     DATE,
    budget       DECIMAL(15,2) NOT NULL CHECK (budget > 0)
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
