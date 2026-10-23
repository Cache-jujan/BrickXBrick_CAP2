// projectTemplates.js — F2: the start screen for "New project".
//
// General Manager only. Read-only: templates are seeded by migration and are
// never edited from the app. Nothing here creates a project; POST /api/projects
// does that, copying the chosen structure inside its own transaction.
//
//   GET  /                         template cards (name, type, size, counts)
//   GET  /copy-sources             past projects that can be copied
//   GET  /copy-sources/:projectId  a past project's milestones and tasks
//   POST /preview                  the dated structure for the dates the GM entered
//   GET  /:id                      a template's milestones and tasks
const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { isUUID } = require("../lib/uuid");
const { isIsoDate, validateProjectDates } = require("../lib/projectRules");
const {
  parseStartRequest,
  loadSource,
  loadTemplateSource,
  loadCopySource,
  buildStructure,
} = require("../lib/projectStructure");

const router = express.Router();
router.use(requireAuth);
router.use(requireRole("General Manager"));

function sendError(res, err) {
  res.status(err.status || 500).json({ error: err.message, ...(err.details || {}) });
}

// What the checklist screen needs: no dates, just names and what can be unticked.
function toChecklist(source) {
  return {
    kind: source.kind,
    id: source.id,
    name: source.name,
    milestones: source.milestones.map((m) => ({
      id: m.id,
      name: m.name,
      phase: m.phase,
      tasks: m.tasks.map((t) => ({
        id: t.id,
        name: t.name,
        handledBy: t.handledBy,
        requirementCode: t.requirementCode,
        defaultIncluded: t.defaultIncluded,
        selectable: t.selectable,
        hint: t.hint,
      })),
    })),
  };
}

router.get("/", async (req, res) => {
  try {
    const result = await query(
      `SELECT t.templateId, t.name, t.projectType, t.size, t.description,
              COUNT(DISTINCT m.templateMilestoneId)::int AS milestoneCount,
              COUNT(k.templateTaskId)::int AS taskCount,
              COUNT(k.templateTaskId) FILTER (WHERE k.defaultIncluded)::int AS defaultTaskCount
         FROM project_templates t
         LEFT JOIN project_template_milestones m ON m.templateId = t.templateId
         LEFT JOIN project_template_tasks k ON k.templateMilestoneId = m.templateMilestoneId
        WHERE t.isActive
        GROUP BY t.templateId
        ORDER BY t.projectType, CASE t.size WHEN 'small' THEN 1 WHEN 'large' THEN 2 ELSE 3 END`
    );
    res.json(
      result.rows.map((r) => ({
        templateId: r.templateid,
        name: r.name,
        projectType: r.projecttype,
        size: r.size,
        description: r.description,
        milestoneCount: r.milestonecount,
        taskCount: r.taskcount,
        defaultTaskCount: r.defaulttaskcount,
      }))
    );
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/copy-sources", async (req, res) => {
  try {
    const result = await query(
      `SELECT p.projectId, p.name, p.projectType, p.status, p.clientName, p.municipality,
              COUNT(DISTINCT m.milestoneId)::int AS milestoneCount,
              COUNT(t.taskId)::int AS taskCount
         FROM projects p
         JOIN milestones m ON m.projectId = p.projectId
         LEFT JOIN tasks t ON t.milestoneId = m.milestoneId
        GROUP BY p.projectId
        ORDER BY p.startDate DESC
        LIMIT 200`
    );
    res.json(
      result.rows.map((r) => ({
        projectId: r.projectid,
        name: r.name,
        projectType: r.projecttype,
        status: r.status,
        clientName: r.clientname,
        municipality: r.municipality,
        milestoneCount: r.milestonecount,
        taskCount: r.taskcount,
      }))
    );
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/copy-sources/:projectId", async (req, res) => {
  try {
    if (!isUUID(req.params.projectId)) return res.status(404).json({ error: "Project to copy not found" });
    res.json(toChecklist(await loadCopySource(query, req.params.projectId)));
  } catch (err) {
    sendError(res, err);
  }
});

// Body: { start, startDate, constructionStartDate, endDate } — the same `start`
// the create call will send. Dates may be entered but unsaved, so nothing is stored.
router.post("/preview", async (req, res) => {
  try {
    const request = parseStartRequest(req.body.start);
    const dates = {
      startDate: req.body.startDate,
      constructionStartDate: req.body.constructionStartDate,
      endDate: req.body.endDate,
    };
    const errors = validateProjectDates(dates);
    if (errors.length) {
      return res.status(400).json({ error: errors.map((e) => e.message).join("; "), fieldErrors: errors });
    }
    for (const value of Object.values(dates)) if (!isIsoDate(value)) return res.status(400).json({ error: "Invalid date" });

    const source = await loadSource(query, request);
    const structure = buildStructure(source, request, dates);
    res.json({
      source: source ? { kind: source.kind, id: source.id, name: source.name } : null,
      ...structure,
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/:id", async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return res.status(404).json({ error: "Template not found" });
    res.json(toChecklist(await loadTemplateSource(query, req.params.id)));
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
