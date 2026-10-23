// projects.js — F2: Project Initialization
//
// Lifecycle (Oct 2026 revision; see lib/projectRules.js for the sources):
//   Draft      created by the GM after the client signs the BOM; PM is assigned
//              now so planning and procurement can start (adviser item 2)
//   Active     activated by the GM once the Site Manager is assigned
//              and the Bill of Materials is approved; tickets and purchases
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
  validateLimits,
  saveLimits,
  projectListScope,
  hideBudgetFrom,
} = require("../lib/projectRules");
const { parseStartRequest, loadSource, buildStructure, insertStructure } = require("../lib/projectStructure");

const router = express.Router();
router.use(requireAuth);

const BROADCAST_ROLES = ["General Manager", "Project Manager", "Site Manager", "Purchaser"];
const PROJECT_MANAGEMENT_ROLES = ["General Manager", "Project Manager"];
const PROJECT_COLUMNS = `projectid, createdby, name, description, clientname, status,
  startdate, constructionstartdate, enddate, actualcompletiondate,
  activatedat, cancelledat, cancellationreason,
  projecttype, municipality, province, siteaddress,
  budget, projectmanagerid, sitemanagerid,
  created_from_template_id, copied_from_project_id`;

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

    const startRequest = parseStartRequest(req.body.start);

    const settings = await loadProjectSettings(query);
    await assertUniqueName(query, fields.name);

    const { project, structure, source } = await withTransaction(async (client) => {
      await assertManagerAvailable(client, { userId: projectManagerId, role: "Project Manager", settings });
      if (siteManagerId) {
        await assertManagerAvailable(client, { userId: siteManagerId, role: "Site Manager", settings });
      }

      // Template / copy: build the dated structure first so a bad choice fails
      // before anything is written. It is copied once; nothing stays linked.
      const sourceRows = await loadSource((text, params) => client.query(text, params), startRequest);
      const built = buildStructure(sourceRows, startRequest, fields);
      if (built.needsSiteManager && !siteManagerId) {
        throw httpError(
          400,
          "Choose a Site Manager: this starting structure has construction tasks, which are assigned to the Site Manager.",
          { fieldErrors: [{ field: "siteManagerId", message: "A Site Manager is required for a structure with construction tasks" }] }
        );
      }

      const insert = await client.query(
        `INSERT INTO projects
           (createdby, name, description, clientname, status,
            startdate, constructionstartdate, enddate,
            projecttype, municipality, province, siteaddress,
            budget, projectmanagerid, sitemanagerid,
            created_from_template_id, copied_from_project_id)
         VALUES ($1, $2, $3, $4, 'Draft', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
          startRequest.mode === "template" ? startRequest.templateId : null,
          startRequest.mode === "copy" ? startRequest.sourceProjectId : null,
        ]
      );
      const created = insert.rows[0];

      await insertStructure(client, {
        projectId: created.projectid,
        createdBy: projectManagerId,
        siteManagerId,
        structure: built,
      });

      // One summary line instead of a notification per task.
      const startNote = built.counts.tasks
        ? ` It starts with ${built.counts.milestones} milestones and ${built.counts.tasks} tasks from ${
            startRequest.mode === "template" ? `the "${sourceRows.name}" template` : `"${sourceRows.name}"`
          }; review the dates and owners.`
        : "";
      await notifyProject(client, {
        recipientId: projectManagerId,
        type: "ProjectAssigned",
        projectId: created.projectid,
        message: `You are the Project Manager of "${created.name}". Planning starts ${fields.startDate}; construction is targeted for ${fields.constructionStartDate}.${startNote}`,
      });
      if (siteManagerId) {
        await notifyProject(client, {
          recipientId: siteManagerId,
          type: "ProjectAssigned",
          projectId: created.projectid,
          message: `You are the Site Manager of "${created.name}". Construction is targeted for ${fields.constructionStartDate}.`,
        });
      }
      return { project: created, structure: built, source: sourceRows };
    });

    res.status(201).json({
      ...project,
      warnings: buildProjectWarnings(fields, settings),
      structure: {
        source: source ? { kind: source.kind, name: source.name } : null,
        milestones: structure.counts.milestones,
        tasks: structure.counts.tasks,
        omittedMilestones: structure.omittedMilestones,
        warningCount: structure.warnings.length,
        warnings: structure.warnings.slice(0, 5),
      },
    });
  } catch (err) {
    sendError(res, err);
  }
});

// LIST — broadcast to GM/PM/SM/Purchaser; optional ?status=Active filter.
// Site Managers and Project Managers are scoped to their own projects so
// pickers cannot expose unrelated projects and ticket creation cannot be
// directed at a project they do not manage. Purchasers see no budget.
router.get("/", requireRole(...BROADCAST_ROLES), async (req, res) => {
  const { status } = req.query;
  try {
    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`p.status = $${params.length}`);
    }
    const scope = projectListScope(req.user);
    if (scope) {
      params.push(scope.value);
      conditions.push(`p.${scope.column} = $${params.length}`);
    }

    // Manager names are joined in so list pages can show who runs each
    // project without one extra request per row.
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await query(
      `SELECT ${DETAIL_COLUMNS},
              pm.name AS projectmanagername, sm.name AS sitemanagername,
              (SELECT ROUND(COALESCE(AVG(m.completionPercentage), 0), 0)
                 FROM milestones m WHERE m.projectId = p.projectId) AS progress
         FROM projects p
         LEFT JOIN users pm ON pm.userid = p.projectmanagerid
         LEFT JOIN users sm ON sm.userid = p.sitemanagerid
         ${where}
        ORDER BY p.startdate DESC`,
      params
    );
    res.json(hideBudgetFrom(req.user, result.rows));
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

// GET /settings/limits — GM. How many open (Draft/Active) projects a PM and an
// SM may hold at once (adviser item 4; client policy, editable without a code change).
router.get("/settings/limits", requireRole("General Manager"), async (req, res) => {
  try {
    const settings = await loadProjectSettings(query);
    res.json({ pm: settings.pmMaxOpenProjects, sm: settings.smMaxOpenProjects });
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /settings/limits — GM. Body { pm?, sm? }, whole numbers 1–10.
// Lowering a limit never unassigns anyone; it only blocks new assignments.
router.patch("/settings/limits", requireRole("General Manager"), async (req, res) => {
  try {
    const limits = validateLimits(req.body);
    await saveLimits(query, limits);
    const settings = await loadProjectSettings(query);
    res.json({ pm: settings.pmMaxOpenProjects, sm: settings.smMaxOpenProjects });
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
      // Client: the price given to the client is the BOM total, so once the
      // BOM is approved the budget follows it (reopen the BOM to change it).
      if (Math.abs(Number(fields.budget) - Number(existing.budget)) > 0.005) {
        const bom = await client.query("SELECT status FROM boms WHERE projectid = $1::uuid", [existing.projectid]);
        if (bom.rows[0]?.status === "Approved") {
          throw httpError(409, "The budget follows the approved BOM total. Reopen the BOM to change it.");
        }
      }
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
// The project's Bill of Materials must be approved (routes/bom.js).
router.patch("/:id/activate", requireRole("General Manager"), async (req, res) => {
  try {
    const project = await withTransaction(async (client) => {
      const existing = await getProjectRow(client, req.params.id, { lock: true });
      assertStatusTransition(existing.status, "Active");
      if (!existing.projectmanagerid) throw httpError(409, "Assign a Project Manager before activating");
      if (!existing.sitemanagerid) throw httpError(409, "Assign a Site Manager before activating");
      // Client: the signed BOM is the basis for every purchase, so no
      // purchases (Active) until the GM has approved the project's BOM.
      const bom = await client.query("SELECT status FROM boms WHERE projectid = $1::uuid", [existing.projectid]);
      if (bom.rows[0]?.status !== "Approved") {
        throw httpError(409, "Approve the project's Bill of Materials before activating");
      }

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
// Only Construction-phase tasks are ever assigned to a Site Manager (see
// reassignSiteManager.js) — clearing the SM (siteManagerId: null) while open
// ones exist would silently leave them with the outgoing SM, so that's
// rejected with 409 instead. Clearing is only allowed once no open
// Construction tasks remain. An Active project must keep a Site Manager.
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
         b.status AS bomstatus,
         (SELECT t.name FROM project_templates t WHERE t.templateId = p.created_from_template_id) AS createdfromtemplatename,
         (SELECT c.name FROM projects c WHERE c.projectId = p.copied_from_project_id) AS copiedfromprojectname,
         ROUND(COALESCE(AVG(m.completionPercentage), 0), 2) AS progress
    FROM projects p
    LEFT JOIN milestones m ON m.projectId = p.projectId
    LEFT JOIN users sm ON sm.userid = p.sitemanagerid
    LEFT JOIN users pm ON pm.userid = p.projectmanagerid
    LEFT JOIN boms b ON b.projectid = p.projectid
   WHERE p.projectid = $1
   GROUP BY p.projectid, sm.name, sm.email, pm.name, pm.email, b.status`;

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
      "SELECT * FROM milestones WHERE projectId = $1 ORDER BY dueDate ASC, sortOrder ASC NULLS LAST",
      [req.params.id]
    );
    const milestones = milestonesResult.rows;

    const milestoneIds = milestones.map((m) => m.milestoneid);
    let tasks = [];
    if (milestones.length > 0) {
      // assignedToName: the timeline shows who a task is assigned to; the bare
      // tasks row only has the assignedTo user id, so it always read "Unassigned".
      const tasksResult = await query(
        `SELECT t.*, u.name AS assignedtoname
           FROM tasks t
           LEFT JOIN users u ON u.userid = t.assignedto
          WHERE t.milestoneId = ANY($1)
          ORDER BY t.dueDate ASC, t.sortOrder ASC NULLS LAST`,
        [milestoneIds]
      );
      tasks = tasksResult.rows;
    }

    // #14: review state per milestone. For each task we look only at its
    // LATEST progress submission (a task that was flagged and then resubmitted
    // should read as "awaiting review", not still "flagged"), then count how
    // many of a milestone's tasks are currently awaiting review vs flagged.
    // This mirrors the join GET /tasks/progress-log already uses.
    const reviewByMilestone = {};
    if (milestoneIds.length > 0) {
      const reviewResult = await query(
        `WITH latest AS (
           SELECT DISTINCT ON (l.taskId)
                  l.taskId, l.reviewStatus, t.milestoneId
             FROM task_progress_log l
             JOIN tasks t ON t.taskId = l.taskId
            WHERE t.milestoneId = ANY($1)
            ORDER BY l.taskId, l.createdAt DESC
         )
         SELECT milestoneId,
                COUNT(*) FILTER (WHERE reviewStatus = 'Pending Review') AS awaitingReview,
                COUNT(*) FILTER (WHERE reviewStatus = 'Flagged') AS flagged
           FROM latest
          GROUP BY milestoneId`,
        [milestoneIds]
      );
      for (const row of reviewResult.rows) {
        reviewByMilestone[row.milestoneid] = {
          awaitingReview: Number(row.awaitingreview) || 0,
          flagged: Number(row.flagged) || 0,
        };
      }
    }

    const milestonesWithTasks = milestones.map((m) => ({
      ...m,
      tasks: tasks.filter((t) => t.milestoneid === m.milestoneid),
      awaitingReview: reviewByMilestone[m.milestoneid]?.awaitingReview || 0,
      flagged: reviewByMilestone[m.milestoneid]?.flagged || 0,
    }));

    res.json({ ...project, milestones: milestonesWithTasks });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
module.exports.validateProjectBody = validateProjectBody;
module.exports.toIso = toIso;