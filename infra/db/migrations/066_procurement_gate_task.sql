-- 066_procurement_gate_task.sql
-- A gate task on the first Construction milestone of every project: the Site Manager
-- reports that all the initial procurement has arrived on site (a photo, reviewed by the PM
-- like any Construction task). Until it is Completed, no other Construction task takes
-- progress (routes/tasks.js, lib/taskProgress.js). Identified by requirementCode
-- 'GATE-PROC-RECEIVED'.
--
-- Safe to re-run: a template or project that already has the gate is skipped.

-- 1. Every template: the gate becomes task 1 of the template's first Construction milestone.
--    project_template_tasks is UNIQUE (templateMilestoneId, sequence) and sequence > 0, so the
--    existing tasks are moved up by 1 in two steps (+1000, then -999) to never collide.
UPDATE project_template_tasks k
   SET sequence = k.sequence + 1000
 WHERE k.templateMilestoneId IN (
         SELECT DISTINCT ON (m.templateId) m.templateMilestoneId
           FROM project_template_milestones m
          WHERE m.phase = 'Construction'
          ORDER BY m.templateId, m.sequence)
   AND NOT EXISTS (SELECT 1 FROM project_template_tasks g
                    WHERE g.templateMilestoneId = k.templateMilestoneId
                      AND g.requirementCode = 'GATE-PROC-RECEIVED')
   AND k.sequence < 1000;

UPDATE project_template_tasks k
   SET sequence = k.sequence - 999
 WHERE k.sequence >= 1000
   AND k.templateMilestoneId IN (
         SELECT DISTINCT ON (m.templateId) m.templateMilestoneId
           FROM project_template_milestones m
          WHERE m.phase = 'Construction'
          ORDER BY m.templateId, m.sequence)
   AND NOT EXISTS (SELECT 1 FROM project_template_tasks g
                    WHERE g.templateMilestoneId = k.templateMilestoneId
                      AND g.requirementCode = 'GATE-PROC-RECEIVED');

INSERT INTO project_template_tasks
  (templateMilestoneId, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
SELECT fc.templateMilestoneId,
       1,
       'Receive all initial procurement on site',
       NULL,
       'GATE-PROC-RECEIVED',
       TRUE,
       'Mark this done ONLY after every ordered material for this phase has physically arrived on site. Attach at least one photo of the delivered materials as proof.',
       0
  FROM (SELECT DISTINCT ON (m.templateId) m.templateMilestoneId
          FROM project_template_milestones m
         WHERE m.phase = 'Construction'
         ORDER BY m.templateId, m.sequence) fc
 WHERE NOT EXISTS (SELECT 1 FROM project_template_tasks g
                    WHERE g.templateMilestoneId = fc.templateMilestoneId
                      AND g.requirementCode = 'GATE-PROC-RECEIVED');

-- 2. Live projects whose Construction phase has not begun: no Construction progress has been
--    logged yet and the project is still open. Needs a Site Manager to own the task. Milestones
--    are ordered like the project overview (dueDate, then sortOrder); a milestone's sortOrder
--    is not the template's sequence and may be empty.
WITH first_cm AS (
  SELECT DISTINCT ON (m.projectId) m.projectId, m.milestoneId, m.dueDate AS milestoneDue,
         p.siteManagerId, p.constructionStartDate
    FROM milestones m
    JOIN projects p ON p.projectId = m.projectId
   WHERE m.phase = 'Construction'
     AND p.status IN ('Draft', 'Active', 'Suspended')
   ORDER BY m.projectId, m.dueDate ASC, m.sortOrder ASC NULLS LAST
), eligible AS (
  SELECT fc.* FROM first_cm fc
   WHERE fc.siteManagerId IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM tasks g
         JOIN milestones gm ON gm.milestoneId = g.milestoneId
        WHERE gm.projectId = fc.projectId
          AND g.requirementCode = 'GATE-PROC-RECEIVED')
     AND NOT EXISTS (
       SELECT 1 FROM tasks t2
         JOIN milestones m2 ON m2.milestoneId = t2.milestoneId
         JOIN task_progress_log l ON l.taskId = t2.taskId
        WHERE m2.projectId = fc.projectId AND m2.phase = 'Construction')
)
INSERT INTO tasks (milestoneId, assignedTo, handledBy, taskName,
                   dueDate, sortOrder, requirementCode, attachmentInstruction)
SELECT e.milestoneId,
       e.siteManagerId,
       NULL,
       'Receive all initial procurement on site',
       COALESCE(e.constructionStartDate, e.milestoneDue),
       0,
       'GATE-PROC-RECEIVED',
       'Mark this done ONLY after every ordered material for this phase has physically arrived on site. Attach at least one photo of the delivered materials as proof.'
  FROM eligible e;
