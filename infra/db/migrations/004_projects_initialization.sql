-- 004_projects_ownership.sql
-- Adds Project Manager (required) and Site Manager (optional) ownership
-- columns to Projects, per F2/F4 dependency resolved with Carl.

ALTER TABLE projects
  ADD COLUMN projectmanagerid UUID REFERENCES users(userid),
  ADD COLUMN sitemanagerid UUID REFERENCES users(userid);

-- Backfill existing row(s) before locking NOT NULL.
-- Confirmed as of this migration: 1 existing row, "Test Site Renovation"
-- (projectid 5c7135b5-7460-409f-8c63-15860e93c1a3), assigned to the only
-- existing Project Manager, "Test PM" (userid 0bc8966f-a3a2-4537-a190-a444b47f6d63).
UPDATE projects
  SET projectmanagerid = '0bc8966f-a3a2-4537-a190-a444b47f6d63'
  WHERE projectid = '5c7135b5-7460-409f-8c63-15860e93c1a3';

ALTER TABLE projects
  ALTER COLUMN projectmanagerid SET NOT NULL;