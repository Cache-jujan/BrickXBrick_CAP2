-- 065_task_attachment_instruction.sql
-- A short PM-facing instruction on a task ("Attach the barangay clearance here"),
-- shown in the task documents dialog. Templates already carry it as
-- project_template_tasks.hint; this column holds it on the live task.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS attachmentInstruction TEXT NULL
    CHECK (attachmentInstruction IS NULL OR char_length(attachmentInstruction) <= 500);

-- Backfill tasks of projects started from a template: the template's hint for the same
-- requirementCode. (A project can leave out template milestones, so its milestones'
-- sortOrder does not always equal the template's sequence; requirementCode alone is
-- what ties a task to its template task.)
UPDATE tasks t
   SET attachmentInstruction = k.hint
  FROM milestones m
  JOIN projects p ON p.projectId = m.projectId
  JOIN project_template_milestones tm ON tm.templateId = p.created_from_template_id
  JOIN project_template_tasks k ON k.templateMilestoneId = tm.templateMilestoneId
 WHERE t.milestoneId = m.milestoneId
   AND t.requirementCode IS NOT NULL
   AND k.requirementCode = t.requirementCode
   AND t.attachmentInstruction IS NULL
   AND k.hint IS NOT NULL
   AND char_length(k.hint) <= 500;
