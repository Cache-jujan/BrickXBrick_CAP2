-- 026_project_lifecycle_and_assignment.sql
--
-- F2 Project Initialization, revised after the Oct 2026 adviser consultation
-- and the pilot client's answers:
--
--   1. Lifecycle dates (adviser item 3; client: "all of the above")
--        startDate              -> "Target date of development" (planning and
--                                  procurement begin; existing column, relabeled)
--        constructionStartDate  -> "Target date of construction"   (NEW)
--        endDate                -> "Target date of completion"     (existing, relabeled)
--        actualCompletionDate   -> actual completion / turnover date (NEW,
--                                  set when the GM marks the project Completed)
--        activatedAt            -> when the project left Draft     (NEW)
--
--   2. Project type and location (adviser items 2 and 3)
--        projectType, municipality, province, siteAddress
--
--   3. Cancellation (client: a project that doesn't push through is cancelled)
--        status gains 'Cancelled'; cancelledAt and cancellationReason record it
--
--   4. Assignment limits (adviser item 2; client answers)
--        system_settings holds the limits so they can change without a
--        code change:
--          pm_max_open_projects = 1  (client: a PM finishes one project
--                                     before taking another)
--          sm_max_open_projects = 3  (client: an SM can handle 3 sites)
--          service_area_municipalities = Consolacion (client: projects
--                                     outside Consolacion are usually
--                                     subcontracted)
--
--   5. Notifications: ProjectAssigned and ProjectActivated, linked to a Project.
--
-- Existing rows are untouched apart from the new nullable columns. The date
-- order checks are added NOT VALID so legacy rows aren't re-checked; every new
-- INSERT/UPDATE is still checked.

-- 1-3. Project columns
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS constructionStartDate DATE NULL,
  ADD COLUMN IF NOT EXISTS actualCompletionDate  DATE NULL,
  ADD COLUMN IF NOT EXISTS activatedAt           TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS cancelledAt           TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS cancellationReason    TEXT NULL,
  ADD COLUMN IF NOT EXISTS projectType           VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS municipality          VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS province              VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS siteAddress           VARCHAR(255) NULL;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check
  CHECK (status IN ('Draft', 'Active', 'Completed', 'Cancelled', 'Archived'));

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_projecttype_check;
ALTER TABLE projects ADD CONSTRAINT projects_projecttype_check
  CHECK (projectType IS NULL OR projectType IN (
    'Residential Building',
    'Commercial Building',
    'Fit-out / Renovation',
    'Civil Works',
    'Structural Retrofitting',
    'Drainage / Flood Control',
    'Road Maintenance',
    'Other'
  ));

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_construction_after_development_check;
ALTER TABLE projects ADD CONSTRAINT projects_construction_after_development_check
  CHECK (constructionStartDate IS NULL OR constructionStartDate >= startDate) NOT VALID;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_completion_after_construction_check;
ALTER TABLE projects ADD CONSTRAINT projects_completion_after_construction_check
  CHECK (endDate IS NULL OR endDate >= COALESCE(constructionStartDate, startDate)) NOT VALID;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_cancellation_reason_check;
ALTER TABLE projects ADD CONSTRAINT projects_cancellation_reason_check
  CHECK (status <> 'Cancelled' OR cancellationReason IS NOT NULL) NOT VALID;

-- 4. Configurable limits
CREATE TABLE IF NOT EXISTS system_settings (
  settingKey   VARCHAR(60) PRIMARY KEY,
  settingValue TEXT NOT NULL,
  description  TEXT NULL,
  updatedAt    TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (settingKey, settingValue, description) VALUES
  ('pm_max_open_projects', '1',
   'Max Draft/Active projects one Project Manager may hold. Client policy: finish one project before taking another.'),
  ('sm_max_open_projects', '3',
   'Max Draft/Active projects one Site Manager may hold. Client policy: up to 3 sites.'),
  ('service_area_municipalities', 'Consolacion',
   'Comma-separated municipalities the company normally serves. Outside these, projects are usually subcontracted; the GM sees a warning.')
ON CONFLICT (settingKey) DO NOTHING;

-- 5. Notifications (keeps every existing type and entity type)
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'ScheduleVarianceAlert', 'ExpenseRejected', 'TamperAlert', 'TaskAssigned',
    'ProjectAssigned', 'ProjectActivated'
  ));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_relatedentitytype_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_relatedentitytype_check
  CHECK (relatedEntityType IN ('Milestone', 'Task', 'Expense', 'Project'));
