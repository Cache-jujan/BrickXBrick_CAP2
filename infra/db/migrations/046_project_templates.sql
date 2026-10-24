-- 046_project_templates.sql
-- Project templates and "copy a past project".
--
-- A template is a STRUCTURE only: milestones (Planning or Construction) and
-- task names, with due dates stored as day offsets from the project's own
-- target dates. Templates hold no BOM data, materials, quantities, prices,
-- assignees, progress, photos, tickets, expenses, receipts or notes.
--
-- Templates are copied into a project when it is created. Nothing stays linked:
-- editing or deleting a template later never changes an existing project.
-- projects.created_from_template_id / copied_from_project_id only record where
-- a project's starting structure came from. At most one of them is set.
--
-- Milestones and tasks also get an optional sortOrder so a template's order is
-- kept when several items share a due date. Existing rows keep NULL and sort
-- exactly as before (by due date).
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS project_templates (
  templateId   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  templateKey  VARCHAR(60)  NOT NULL UNIQUE,
  name         VARCHAR(150) NOT NULL,
  projectType  VARCHAR(50)  NOT NULL,
  size         VARCHAR(20)  NOT NULL CHECK (size IN ('small', 'large', 'custom')),
  description  TEXT NULL,
  version      VARCHAR(20)  NOT NULL DEFAULT '0.2',
  isActive     BOOLEAN NOT NULL DEFAULT TRUE,
  createdAt    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_template_milestones (
  templateMilestoneId UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  templateId          UUID NOT NULL REFERENCES project_templates(templateId) ON DELETE CASCADE,
  sequence            INTEGER NOT NULL CHECK (sequence > 0),
  name                VARCHAR(150) NOT NULL,
  phase               VARCHAR(20)  NOT NULL CHECK (phase IN ('Planning', 'Construction')),
  dueOffsetDays       INTEGER NOT NULL CHECK (dueOffsetDays >= 0),
  UNIQUE (templateId, sequence)
);

CREATE TABLE IF NOT EXISTS project_template_tasks (
  templateTaskId      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  templateMilestoneId UUID NOT NULL REFERENCES project_template_milestones(templateMilestoneId) ON DELETE CASCADE,
  sequence            INTEGER NOT NULL CHECK (sequence > 0),
  name                VARCHAR(150) NOT NULL,
  -- Planning tasks are owned by a role; Construction tasks go to the Site Manager.
  handledBy           VARCHAR(2) NULL CHECK (handledBy IS NULL OR handledBy IN ('GM', 'PM')),
  -- Set for permit/document tasks (BP-* standard, COND-* conditional).
  requirementCode     VARCHAR(40) NULL,
  defaultIncluded     BOOLEAN NOT NULL DEFAULT TRUE,
  hint                TEXT NULL,
  dueOffsetDays       INTEGER NOT NULL CHECK (dueOffsetDays >= 0),
  UNIQUE (templateMilestoneId, sequence)
);

CREATE INDEX IF NOT EXISTS idx_template_milestones_template ON project_template_milestones (templateId);
CREATE INDEX IF NOT EXISTS idx_template_tasks_milestone ON project_template_tasks (templateMilestoneId);

-- Where a project's starting structure came from (never both).
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS created_from_template_id UUID NULL REFERENCES project_templates(templateId) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS copied_from_project_id   UUID NULL REFERENCES projects(projectId) ON DELETE SET NULL;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_single_origin_check;
ALTER TABLE projects ADD CONSTRAINT projects_single_origin_check
  CHECK (num_nonnulls(created_from_template_id, copied_from_project_id) <= 1);

-- Keeps template order for items that share a due date. NULL = no preference.
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS sortOrder INTEGER NULL;
ALTER TABLE tasks      ADD COLUMN IF NOT EXISTS sortOrder INTEGER NULL;

-- Which permit/document requirement a task stands for, if any.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS requirementCode VARCHAR(40) NULL;
