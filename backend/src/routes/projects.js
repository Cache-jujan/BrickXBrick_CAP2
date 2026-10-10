// projects.js — F2: Project Initialization
//
// Lifecycle (Oct 2026 revision; see lib/projectRules.js for the sources):
//   Draft      created by the GM after the client signs the BOM; PM is assigned
//              now so planning and procurement can start (adviser item 2)
//   Active     activated by the GM once the Site Manager is assigned
//              (Patch 2 adds: and the BOM is approved); tickets and purchases
//              are only allowed from here
//   Completed  the GM records the actual completion / turnover date
//   Cancelled  the project didn't push through; a reason is required
const express = require("express");
const { query, withTransaction } = require("../lib/db");
const { reassignSiteManager } = require("../lib/reassignSiteManager");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const {
  PROJECT_TYPES,
  CLOSED_PROJECT_STATUSES,
  httpError,
  isIsoDate,
  validateProjectDates,
  buildProjectWarnings,
  assertStatusTransition,
  loadProjectSettings,
  loadManagerWorkload,
  assertManagerAvailable,
  notifyProject,
} = require("../lib/projectRules");

const router = express.Router();
router.use(requireAuth);

const BROADCAST_ROLES = ["General Manager", "Project Manager", "Site Manager", "Purchaser"];
const PROJECT_MANAGEMENT_ROLES = ["General Manager", "Project Manager"];
const PROJECT_COLUMNS = `projectid, createdby, name, description, clientname, status,
  startdate, constructionstartdate, enddate, actualcompletiondate,
  activatedat, cancelledat, cancellationreason,
  projecttype, municipality, province, siteaddress,
  budget, projectmanagerid, sitemanagerid`;

// p.-prefixed version for the joined detail queries.
const DETAIL_COLUMNS = PROJECT_COLUMNS.split(",").map((c) => `p.${c.trim()}`).join(", ");

function sendError(res, err) {
  res.status(err.status || 500).json({ error: err.message, ...(err.details || {}) });
}

// Accepts either the pool's query function or a transaction client.
function runnerOf(target) {
  return typeof target === "function" ? target : (text, params) => target.query(text, params);
}

function trimOrNull(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

// Name must be unique among projects that are still in play (UC-02-01 E1).
async function assertUniqueName(target, name, excludeProjectId = null) {
  const result = await runnerOf(target)(
    `SELECT 1 FROM projects
      WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
        AND status NOT IN ('Cancelled', 'Archived')
        AND ($2::uuid IS NULL OR projectid <> $2::uuid)
      LIMIT 1`,
    [name, excludeProjectId]
  );
  if (result.rowCount > 0) {
    throw httpError(409, "Project name already exists. Please use a unique name.");
  }
}

// Shared validation for create and edit. `existing` is the stored row on edit.
function validateProjectBody(body, existing = null) {
  const merged = {
    name: body.name !== undefined ? trimOrNull(body.name) : existing?.name ?? null,
    clientName: body.clientName !== undefined ? trimOrNull(body.clientName) : existing?.clientname ?? null,
    budget: body.budget !== undefined ? body.budget : existing ? Number(existing.budget) : undefined,
    startDate: body.startDate !== undefined ? body.startDate : toIso(existing?.startdate),
    constructionStartDate:
      body.constructionStartDate !== undefined ? body.constructionStartDate : toIso(existing?.constructionstartdate),
    endDate: body.endDate !== undefined ? body.endDate : toIso(existing?.enddate),
    projectType: body.projectType !== undefined ? body.projectType : existing?.projecttype ?? null,
    municipality: body.municipality !== undefined ? trimOrNull(body.municipality) : existing?.municipality ?? null,
  };

  const errors = [];
  if (!merged.name) errors.push({ field: "name", message: "Project name is required" });
  if (!merged.clientName) errors.push({ field: "clientName", message: "Client name is required" });
  if (typeof merged.budget !== "number" || !Number.isFinite(merged.budget) || merged.budget < 0) {
    errors.push({ field: "budget", message: "Target budget must be a number of 0 or more" });
  }
  if (!PROJECT_TYPES.includes(merged.projectType)) {
    errors.push({ field: "projectType", message: `Project type must be one of: ${PROJECT_TYPES.join(", ")}` });
  }
  if (!merged.municipality) {
    errors.push({ field: "municipality", message: "Municipality / city of the site is required" });
  }
  errors.push(...validateProjectDates(merged));

  if (errors.length) {
    throw httpError(400, errors.map((e) => e.message).join("; "), { fieldErrors: errors });
  }
  return merged;
}

// node-postgres returns a DATE as a JS Date at *local* midnight of the
// server. toISOString() would convert that to UTC, which on a Philippine
// server (UTC+8) is the previous day — so read the local calendar fields.
function toIso(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function getProjectRow(target, projectId, { lock = false } = {}) {
  const result = await runnerOf(target)(
    `SELECT ${PROJECT_COLUMNS} FROM projects WHERE projectid = $1${lock ? " FOR UPDATE" : ""}`,
    [projectId]
  );
  if (result.rowCount === 0) throw httpError(404, "Project not found");
  return result.rows[0];
}

// CREATE — GM only. The client has already signed the BOM; the project
// starts as Draft so the PM can plan before construction (adviser item 2).
router.post("/", requireRole("General Manager"), async (req, res) => {
  try {
    const fields = validateProjectBody(req.body);
    const description = trimOrNull(req.body.description);
    const province = trimOrNull(req.body.province);
    const siteAddress = trimOrNull(req.body.siteAddress);
    const { projectManagerId } = req.body;
    const siteManagerId = req.body.siteManagerId || null;

    if (!projectManagerId) throw httpError(400, "projectManagerId is required");

    const settings = await loadProjectSettings(query);
    await assertUniqueName(query, fields.name);

    const project = await withTransaction(async (client) => {
      await assertManagerAvailable(client, { userId: projectManagerId, role: "Project Manager", settings });
      if (siteManagerId) {
        await assertManagerAvailable(client, { userId: siteManagerId, role: "Site Manager", settings });
      }

      const insert = await client.query(
        `INSERT INTO projects
           (createdby, name, description, clientname, status,
            startdate, constructionstartdate, enddate,
            projecttype, municipality, province, siteaddress,
            budget, projectmanagerid, sitemanagerid)
         VALUES ($1, $2, $3, $4, 'Draft', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING ${PROJECT_COLUMNS}`,
        [
          req.user.id,
          fields.name,
          description,
          fields.clientName,
          fields.startDate,
          fields.constructionStartDate,
          fields.endDate,
          fields.projectType,
          fields.municipality,
          province,
          siteAddress,
          fields.budget,
          projectManagerId,
          siteManagerId,
        ]
      );
      const created = insert.rows[0];

      await notifyProject(client, {
        recipientId: projectManagerId,
        type: "ProjectAssigned",
        projectId: created.projectid,
        message: `You are the Project Manager of "${created.name}". Planning starts ${fields.startDate}; construction is targeted for ${fields.constructionStartDate}.`,
      });
      if (siteManagerId) {
        await notifyProject(client, {
          recipientId: siteManagerId,
          type: "ProjectAssigned",
          projectId: created.projectid,
          message: `You are the Site Manager of "${created.name}". Construction is targeted for ${fields.constructionStartDate}.`,
        });
      }
      return created;
    });

    res.status(201).json({ ...project, warnings: buildProjectWarnings(fields, settings) });
  } catch (err) {
    sendError(res, err);
  }
});

// LIST — broadcast to GM/PM/SM/Purchaser; optional ?status=Active filter.
// Site Managers are scoped to projects assigned to their account so project
// pickers cannot expose unrelated projects and ticket creation cannot be
// directed at a project they do not manage.
router.get("/", requireRole(...BROADCAST_ROLES), async (req, res) => {
  const { status } = req.query;
  try {
    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`p.status = $${params.length}`);
    }
    if (req.user.role === "Site Manager") {
      params.push(req.user.id);
      conditions.push(`p.siteManagerId = $${params.length}`);
    }

    // Manager names are joined in so list pages can show who runs each
    // project without one extra request per row.
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await query(
      `SELECT ${DETAIL_COLUMNS},
              pm.name AS projectmanagername, sm.name AS sitemanagername
         FROM projects p
         LEFT JOIN users pm ON pm.userid = p.projectmanagerid
         LEFT JOIN users sm ON sm.userid = p.sitemanagerid
         ${where}
        ORDER BY p.startdate DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    sendError(res, err);
  }
});

// GET /eligible-managers?projectId= — GM only. Every active PM with the open
// projects they hold and whether they can take one more. The dropdown shows
// only `available` managers; the busy ones are listed with their schedules
// (adviser item 2). Pass projectId when editing so the current project
// doesn't count against its own PM.
router.get("/eligible-managers", requireRole("General Manager"), async (req, res) => {
  try {
    const excludeProjectId = req.query.projectId || null;
    const settings = await loadProjectSettings(query);
    res.json(await loadManagerWorkload(query, "Project Manager", { excludeProjectId, settings }));
  } catch (err) {
    sendError(res, err);
  }
});

// GET /eligible-site-managers?projectId= — GM/PM. Same shape as above.
router.get("/eligible-site-managers", requireRole("General Manager", "Project Manager"), async (req, res) => {
  try {
    const excludeProjectId = req.query.projectId || null;
    const settings = await loadProjectSettings(query);
    res.json(await loadManagerWorkload(query, "Site Manager", { excludeProjectId, settings }));
  } catch (err) {
    sendError(res, err);
  }
});

// GET /options — values the Create/Edit Project form needs.
router.get("/options", requireRole("General Manager"), async (req, res) => {
  try {
    const settings = await loadProjectSettings(query);
    res.json({
      projectTypes: PROJECT_TYPES,
      serviceAreaMunicipalities: settings.serviceAreaMunicipalities,
      pmMaxOpenProjects: settings.pmMaxOpenProjects,
      smMaxOpenProjects: settings.smMaxOpenProjects,
    });
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /:id — GM edits project details (adviser item 4). Status changes use
// the dedicated routes below. Completed/Cancelled/Archived projects are read-only.
router.patch("/:id", requireRole("General Manager"), async (req, res) => {
  try {
    const settings = await loadProjectSettings(query);

    const updated = await withTransaction(async (client) => {
      const existing = await getProjectRow(client, req.params.id, { lock: true });
      if (CLOSED_PROJECT_STATUSES.includes(existing.status)) {
        throw httpError(409, `A ${existing.status} project can no longer be edited`);
      }

      const fields = validateProjectBody(req.body, existing);
      if (fields.name.toLowerCase() !== String(existing.name).trim().toLowerCase()) {
        await assertUniqueName(client, fields.name, existing.projectid);
      }

      const description =
        req.body.description !== undefined ? trimOrNull(req.body.description) : existing.description;
      const province = req.body.province !== undefined ? trimOrNull(req.body.province) : existing.province;
      const siteAddress =
        req.body.siteAddress !== undefined ? trimOrNull(req.body.siteAddress) : existing.siteaddress;

      let projectManagerId = existing.projectmanagerid;
      const pmChanged =
        req.body.projectManagerId !== undefined && req.body.projectManagerId !== existing.projectmanagerid;
      if (pmChanged) {
        if (!req.body.projectManagerId) throw httpError(400, "A project must keep a Project Manager");
        await assertManagerAvailable(client, {
          userId: req.body.projectManagerId,
          role: "Project Manager",
          excludeProjectId: existing.projectid,
          settings,
        });
        projectManagerId = req.body.projectManagerId;
      }

      const result = await client.query(
        `UPDATE projects
            SET name = $2, description = $3, clientname = $4, budget = $5,
                startdate = $6, constructionstartdate = $7, enddate = $8,
                projecttype = $9, municipality = $10, province = $11, siteaddress = $12,
                projectmanagerid = $13
          WHERE projectid = $1
          RETURNING ${PROJECT_COLUMNS}`,
        [
          existing.projectid,
          fields.name,
          description,
          fields.clientName,
          fields.budget,
          fields.startDate,
          fields.constructionStartDate,
          fields.endDate,
          fields.projectType,
          fields.municipality,
          province,
          siteAddress,
          projectManagerId,
        ]
      );
      const row = result.rows[0];

      if (pmChanged) {
        await notifyProject(client, {
          recipientId: projectManagerId,
          type: "ProjectAssigned",
          projectId: row.projectid,
          message: `You are now the Project Manager of "${row.name}".`,
        });
      }
      return { row, fields };
    });

    res.json({ ...updated.row, warnings: buildProjectWarnings(updated.fields, settings) });
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /:id/activate — GM. Draft -> Active. Requires both managers assigned.
// Patch 2 (BOM) adds: the project's BOM must be approved.
router.patch("/:id/activate", requireRole("General Manager"), async (req, res) => {
  try {
    const project = await withTransaction(async (client) => {
      const existing = await getProjectRow(client, req.params.id, { lock: true });
      assertStatusTransition(existing.status, "Active");
      if (!existing.projectmanagerid) throw httpError(409, "Assign a Project Manager before activating");
      if (!existing.sitemanagerid) throw httpError(409, "Assign a Site Manager before activating");

      const result = await client.query(
        `UPDATE projects SET status = 'Active', activatedAt = NOW()
          WHERE projectid = $1 RETURNING ${PROJECT_COLUMNS}`,
        [existing.projectid]
      );
      const row = result.rows[0];

      const recipients = new Set([row.projectmanagerid, row.sitemanagerid]);
      const purchasers = await client.query(
        "SELECT userid FROM users WHERE role = 'Purchaser' AND status = 'Active'"
      );
      purchasers.rows.forEach((p) => recipients.add(p.userid));
      for (const recipientId of recipients) {
        await notifyProject(client, {
          recipientId,
          type: "ProjectActivated",
          projectId: row.projectid,
          message: `"${row.name}" is now Active. Material requests and purchases can begin.`,
        });
      }
      return row;
    });
    res.json(project);
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /:id/cancel — GM. Draft/Active -> Cancelled, with a reason
// (client: a project that doesn't push through is cancelled).
router.patch("/:id/cancel", requireRole("General Manager"), async (req, res) => {
  try {
    const reason = trimOrNull(req.body.reason);
    if (!reason) throw httpError(400, "A cancellation reason is required");

    const project = await withTransaction(async (client) => {
      const existing = await getProjectRow(client, req.params.id, { lock: true });
      assertStatusTransition(existing.status, "Cancelled");
      const result = await client.query(
        `UPDATE projects
            SET status = 'Cancelled', cancelledAt = NOW(), cancellationReason = $2
          WHERE projectid = $1 RETURNING ${PROJECT_COLUMNS}`,
        [existing.projectid, reason]
      );
      return result.rows[0];
    });
    res.json(project);
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /:id/complete — GM. Active -> Completed, recording the actual
// completion / turnover date (defaults to today).
router.patch("/:id/complete", requireRole("General Manager"), async (req, res) => {
  try {
    const completionDate = req.body.actualCompletionDate || new Date().toISOString().slice(0, 10);
    if (!isIsoDate(completionDate)) {
      throw httpError(400, "actualCompletionDate must be a valid date (YYYY-MM-DD)");
    }

    const project = await withTransaction(async (client) => {
      const existing = await getProjectRow(client, req.params.id, { lock: true });
      assertStatusTransition(existing.status, "Completed");
      if (completionDate < toIso(existing.startdate)) {
        throw httpError(400, "The completion date can't be before the target date of development");
      }
      const result = await client.query(
        `UPDATE projects SET status = 'Completed', actualCompletionDate = $2
          WHERE projectid = $1 RETURNING ${PROJECT_COLUMNS}`,
        [existing.projectid, completionDate]
      );
      return result.rows[0];
    });
    res.json(project);
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /:id/site-manager — GM or the owning PM may assign, replace, or clear
// the Site Manager. Only active Site Manager accounts under the SM project
// limit are valid assignments.
//
// D-02: tasks.assignedTo is copied at task-create time and was never moved
// when the project's SM changed, so the old SM kept backend access to open
// tasks and the new SM got 403 on them. Reassignment now moves every open
// (non-Completed) task under this project's milestones to the new SM in the
// same transaction as the project update. Completed tasks keep their
// original assignee — the work and photo evidence really are theirs, and
// the PM review route doesn't key off current assignment anyway.
//
// tasks.assignedTo is NOT NULL, so clearing the SM (siteManagerId: null)
// while open tasks exist would silently leave them with the outgoing SM —
// that's rejected with 409 instead. Clearing is only allowed once no open
// tasks remain. An Active project must keep a Site Manager.
router.patch("/:id/site-manager", requireRole("General Manager", "Project Manager"), async (req, res) => {
  const siteManagerId = req.body.siteManagerId || null;

  try {
    const settings = await loadProjectSettings(query);

    const result = await withTransaction(async (client) => {
      const project = await getProjectRow(client, req.params.id, { lock: true });
      await assertProjectAccess(project, req.user);

      if (CLOSED_PROJECT_STATUSES.includes(project.status)) {
        throw httpError(409, `A ${project.status} project can no longer be reassigned`);
      }
      if (!siteManagerId && project.status === "Active") {
        throw httpError(409, "An Active project must keep a Site Manager; choose a replacement instead");
      }
      const changed = siteManagerId && siteManagerId !== project.sitemanagerid;
      if (changed) {
        await assertManagerAvailable(client, {
          userId: siteManagerId,
          role: "Site Manager",
          excludeProjectId: project.projectid,
          settings,
        });
      }

      await reassignSiteManager(client, { projectId: req.params.id, siteManagerId });

      const updateResult = await client.query(
        `UPDATE projects
            SET siteManagerId = $1
          WHERE projectid = $2
          RETURNING ${PROJECT_COLUMNS},
            (SELECT name FROM users WHERE userid = projects.siteManagerId) AS siteManagerName,
            (SELECT email FROM users WHERE userid = projects.siteManagerId) AS siteManagerEmail`,
        [siteManagerId, req.params.id]
      );
      const row = updateResult.rows[0];

      if (changed) {
        await notifyProject(client, {
          recipientId: siteManagerId,
          type: "ProjectAssigned",
          projectId: row.projectid,
          message: `You are now the Site Manager of "${row.name}".`,
        });
      }
      return row;
    });

    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

// Shared helper: throws 403 unless caller is GM, or the PM assigned to this project.
async function assertProjectAccess(project, user) {
  if (user.role === "General Manager") return;
  if (user.role === "Project Manager" && project.projectmanagerid === user.id) return;
  const err = new Error("You do not have access to this project");
  err.status = 403;
  throw err;
}

const DETAIL_SELECT = `
  SELECT ${DETAIL_COLUMNS},
         sm.name AS sitemanagername, sm.email AS sitemanageremail,
         pm.name AS projectmanagername, pm.email AS projectmanageremail,
         ROUND(COALESCE(AVG(m.completionPercentage), 0), 2) AS progress
    FROM projects p
    LEFT JOIN milestones m ON m.projectId = p.projectId
    LEFT JOIN users sm ON sm.userid = p.sitemanagerid
    LEFT JOIN users pm ON pm.userid = p.projectmanagerid
   WHERE p.projectid = $1
   GROUP BY p.projectid, sm.name, sm.email, pm.name, pm.email`;

async function loadDetail(projectId) {
  const result = await query(DETAIL_SELECT, [projectId]);
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  const settings = await loadProjectSettings(query);
  return { ...row, warnings: buildProjectWarnings({ municipality: row.municipality }, settings) };
}

// SINGLE — includes computed overall progress (mean of milestone completion %)
router.get("/:id", requireRole(...PROJECT_MANAGEMENT_ROLES), async (req, res) => {
  try {
    const project = await loadDetail(req.params.id);
    if (!project) return res.status(404).json({ error: "Not found" });
    await assertProjectAccess(project, req.user);
    res.json(project);
  } catch (err) {
    sendError(res, err);
  }
});

// GET /:id/overview — project + progress + all milestones, each with its tasks nested.
// One combined payload for a GM/PM overview page instead of N+1 calls
// (project detail -> milestone list -> per-milestone task list).
router.get("/:id/overview", requireRole(...PROJECT_MANAGEMENT_ROLES), async (req, res) => {
  try {
    const project = await loadDetail(req.params.id);
    if (!project) return res.status(404).json({ error: "Not found" });
    await assertProjectAccess(project, req.user);

    const milestonesResult = await query(
      "SELECT * FROM milestones WHERE projectId = $1 ORDER BY dueDate ASC",
      [req.params.id]
    );
    const milestones = milestonesResult.rows;

    let tasks = [];
    if (milestones.length > 0) {
      const milestoneIds = milestones.map((m) => m.milestoneid);
      const tasksResult = await query(
        "SELECT * FROM tasks WHERE milestoneId = ANY($1) ORDER BY dueDate ASC",
        [milestoneIds]
      );
      tasks = tasksResult.rows;
    }

    const milestonesWithTasks = milestones.map((m) => ({
      ...m,
      tasks: tasks.filter((t) => t.milestoneid === m.milestoneid),
    }));

    res.json({ ...project, milestones: milestonesWithTasks });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
module.exports.validateProjectBody = validateProjectBody;
module.exports.toIso = toIso;
