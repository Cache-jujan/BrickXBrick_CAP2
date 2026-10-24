// milestones.js — F3: milestone + task creation, PM-owned only.
const express = require("express");
const { query, withTransaction } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { recalcMilestoneProgress } = require("../lib/milestoneProgress");
const { dateWindowWarning } = require("../lib/scheduleWindows");
const { isUUID } = require("../lib/uuid");
const { parseTimelineChanges, applyTimelineChanges, loadTimelineLocks } = require("../lib/timelineEdit");

const MILESTONE_PHASES = ["Planning", "Construction"];

// Statuses on which the PM may still plan work (milestones and tasks).
const PLANNABLE_STATUSES = ["Draft", "Active"];

const router = express.Router();
router.use(requireAuth);

async function getOwnedProject(projectId, userId) {
    const result = await query(
        `SELECT projectId, projectManagerId, siteManagerId, status,
                startDate, constructionStartDate, endDate
           FROM projects WHERE projectId = $1`,
        [projectId]
    );
    if (result.rowCount === 0) {
        const err = new Error(`Project ${projectId} not found`);
        err.status = 404;
        throw err;
    }
    const project = result.rows[0];
    if (project.projectmanagerid !== userId) {
        const err = new Error("You may only manage milestones on a project you are the Project Manager for");
        err.status = 403;
        throw err;
    }
    // D-11: an Archived project had no status check, so milestones/tasks
    // could still be created on a project that's supposed to be closed.
    // Draft is allowed too: the PM plans the project (e.g. a "Planning
    // phase" milestone) before construction starts — adviser item 2.
    if (!PLANNABLE_STATUSES.includes(project.status)) {
        const err = new Error(`This project is ${project.status} — milestones and tasks can only be created on a Draft or Active project`);
        err.status = 409;
        throw err;
    }
    return project;
}

// D-03: GM, the owning PM, or the project's assigned SM — same boundary
// projects.js already enforces on project reads. Milestone routes had only
// requireAuth, so any logged-in role could read another project's data.
function assertProjectAccess(project, user) {
    if (user.role === "General Manager") return;
    if (user.role === "Project Manager" && project.projectmanagerid === user.id) return;
    if (user.role === "Site Manager" && project.sitemanagerid === user.id) return;
    const err = new Error("You do not have access to this project");
    err.status = 403;
    throw err;
}

async function getProjectAccess(projectId) {
    const result = await query(
        "SELECT projectId, projectManagerId, siteManagerId FROM projects WHERE projectId = $1",
        [projectId]
    );
    if (result.rowCount === 0) {
        const err = new Error(`Project ${projectId} not found`);
        err.status = 404;
        throw err;
    }
    return result.rows[0];
}

async function getMilestoneWithProject(milestoneId) {
    const result = await query(
        `SELECT m.*, p.projectManagerId, p.siteManagerId, p.status AS projectStatus,
                p.startDate, p.constructionStartDate, p.endDate
           FROM milestones m
           JOIN projects p ON p.projectId = m.projectId
          WHERE m.milestoneId = $1`,
        [milestoneId]
    );
    if (result.rowCount === 0) {
        const err = new Error(`Milestone ${milestoneId} not found`);
        err.status = 404;
        throw err;
    }
    return result.rows[0];
}

// POST / — PM creates a milestone under a project they manage.
router.post("/", requireRole("Project Manager"), async (req, res, next) => {
    try {
        const { projectID, dueDate } = req.body;
        // D-12: the web UI trims before posting, but the API accepted a
        // whitespace-only name directly (e.g. "   ") — trim server-side too.
        const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
        // #5: a milestone's phase decides how its tasks will later be owned
        // (Planning → Handled by GM/PM, no Site Manager; Construction →
        // assigned to the project's Site Manager, existing behavior).
        // Defaults to Construction so every pre-#5 caller keeps working
        // unchanged.
        const phase = req.body.phase || "Construction";

        if (!projectID || !name || !dueDate) {
            const err = new Error("projectID, name, and dueDate are required");
            err.status = 400;
            throw err;
        }
        if (!MILESTONE_PHASES.includes(phase)) {
            const err = new Error(`phase must be one of: ${MILESTONE_PHASES.join(", ")}`);
            err.status = 400;
            throw err;
        }

        const project = await getOwnedProject(projectID, req.user.id);

        // Non-blocking: the PM is told but never stopped — they may have a
        // real reason for a date outside the usual window.
        const warning = dateWindowWarning(phase, dueDate, project);

        const milestone = await withTransaction(async (client) => {
            const insertResult = await client.query(
                `INSERT INTO milestones (projectId, createdBy, name, dueDate, phase)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [projectID, req.user.id, name, dueDate, phase]
            );
            const newMilestone = insertResult.rows[0];

            // A milestone can be created already past its own due date
            // (W-03) — derive its real status immediately instead of
            // leaving it "On Track" until the next task or sweep.
            await recalcMilestoneProgress(client, newMilestone.milestoneid);

            const refreshed = await client.query(
                "SELECT * FROM milestones WHERE milestoneId = $1",
                [newMilestone.milestoneid]
            );
            return refreshed.rows[0];
        });

        res.status(201).json({ ...milestone, warnings: warning ? [warning] : [] });
    } catch (err) {
        next(err);
    }
});

// GET /?projectId= — list milestones for a project.
router.get("/", async (req, res, next) => {
    try {
        const { projectId } = req.query;
        if (!projectId) {
            const err = new Error("projectId query parameter is required");
            err.status = 400;
            throw err;
        }

        const project = await getProjectAccess(projectId);
        assertProjectAccess(project, req.user);

        const result = await query(
            "SELECT * FROM milestones WHERE projectId = $1 ORDER BY dueDate ASC",
            [projectId]
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// GET /attention — the owning PM's at-risk and overdue milestones across their
// open projects, for the dashboard "Needs your attention" panel. Declared
// before "/:id" so Express doesn't read "attention" as a milestone id.
// Milestone status is the server-derived schedule status (milestoneProgress.js);
// this only reads it, it doesn't recompute.
router.get("/attention", requireRole("Project Manager"), async (req, res, next) => {
    try {
        const result = await query(
            `SELECT m.milestoneId, m.name, m.dueDate, m.status, m.completionPercentage,
                    p.projectId, p.name AS projectName
               FROM milestones m
               JOIN projects p ON p.projectId = m.projectId
              WHERE p.projectManagerId = $1
                AND p.status IN ('Draft', 'Active')
                AND m.status IN ('At Risk', 'Overdue')
              ORDER BY m.dueDate ASC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// GET /timeline/locks?projectId= — the tasks of this project that cannot be
// deleted (they have a progress submission or attached documents), so the
// "Edit timeline" modal can say so before the PM tries. Owning PM only, on a
// Draft or Active project, like the edit itself. Declared before "/:id".
// -> { locks: { [taskId]: "progress" | "documents" } }
router.get("/timeline/locks", requireRole("Project Manager"), async (req, res, next) => {
    try {
        const { projectId } = req.query;
        if (!isUUID(projectId)) {
            const err = new Error("projectId query parameter must be a valid id");
            err.status = 400;
            throw err;
        }
        await getOwnedProject(projectId, req.user.id);
        res.json({ locks: await loadTimelineLocks(query, projectId) });
    } catch (err) {
        next(err);
    }
});

// PATCH /timeline — the PM's "Edit timeline" save: rename, re-date and delete
// milestones and tasks of one project in a single all-or-nothing transaction.
// body: { projectID,
//         milestones: [{ milestoneID, name?, dueDate?, remove? }],
//         tasks:      [{ taskID, taskName?, dueDate?, remove? }] }
// 409 (with details.errors) when something can't be saved: a completed task, or
// a task with progress or documents being deleted. Nothing is saved then.
router.patch("/timeline", requireRole("Project Manager"), async (req, res, next) => {
    try {
        const { projectID } = req.body || {};
        if (!isUUID(projectID)) {
            const err = new Error("projectID is required");
            err.status = 400;
            throw err;
        }
        const changes = parseTimelineChanges(req.body);
        const project = await getOwnedProject(projectID, req.user.id);
        const result = await withTransaction((client) => applyTimelineChanges(client, project, changes));
        res.json(result);
    } catch (err) {
        next(err);
    }
});

const TASK_HANDLERS = ["GM", "PM"];

// POST /:id/tasks — PM creates a task under a milestone they own.
// Construction milestones: task is assigned to the project's Site Manager
// (schema is 1 SM per project — no open pick), exactly as before.
// Planning milestones (#5): there's no Site Manager involvement at all —
// the task is just "Handled by: GM" or "Handled by: PM" (informational),
// assignedTo stays NULL, and only a PM can later mark it done.
router.post("/:id/tasks", requireRole("Project Manager"), async (req, res, next) => {
    try {
        const { taskName, dueDate, handledBy } = req.body;

        if (!taskName || !dueDate) {
            const err = new Error("taskName and dueDate are required");
            err.status = 400;
            throw err;
        }

        const milestone = await getMilestoneWithProject(req.params.id);

        if (milestone.projectmanagerid !== req.user.id) {
            const err = new Error("You may only add tasks to a milestone on a project you are the Project Manager for");
            err.status = 403;
            throw err;
        }
        // D-11: mirror getOwnedProject's Active check here — this route
        // reaches the project via the milestone, not getOwnedProject.
        if (!PLANNABLE_STATUSES.includes(milestone.projectstatus)) {
            const err = new Error(`This project is ${milestone.projectstatus} — tasks can only be created on a Draft or Active project`);
            err.status = 409;
            throw err;
        }

        const isPlanning = milestone.phase === "Planning";

        if (isPlanning) {
            if (!TASK_HANDLERS.includes(handledBy)) {
                const err = new Error(`handledBy is required for a Planning task and must be one of: ${TASK_HANDLERS.join(", ")}`);
                err.status = 400;
                throw err;
            }
        } else if (!milestone.sitemanagerid) {
            const err = new Error("This project has no Site Manager assigned yet — assign one before creating tasks");
            err.status = 400;
            throw err;
        }

        const warning = dateWindowWarning(milestone.phase, dueDate, milestone);

        const task = await withTransaction(async (client) => {
            const insertResult = await client.query(
                `INSERT INTO tasks (milestoneId, assignedTo, handledBy, taskName, dueDate)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [
                    req.params.id,
                    isPlanning ? null : milestone.sitemanagerid,
                    isPlanning ? handledBy : null,
                    taskName,
                    dueDate,
                ]
            );
            const newTask = insertResult.rows[0];

            // A new task starts at 0% and shifts the milestone's average —
            // recalc now, not just when future progress updates land (F5).
            await recalcMilestoneProgress(client, req.params.id);

            // D-16: UC-03-01 step 5 says the system notifies the assigned
            // SM. Planning tasks have no SM to notify — PM created it and
            // the PM handles it, so there's no one else to tell.
            if (!isPlanning) {
                await client.query(
                    `INSERT INTO notifications (recipientId, type, relatedEntityType, relatedEntityId, message)
                     VALUES ($1, 'TaskAssigned', 'Task', $2, $3)`,
                    [milestone.sitemanagerid, newTask.taskid, `You were assigned a new task: "${taskName}" — due ${new Date(dueDate).toDateString()}.`]
                );
            }

            return newTask;
        });

        res.status(201).json({ ...task, warnings: warning ? [warning] : [] });
    } catch (err) {
        next(err);
    }
});

// GET /:id — single milestone with its tasks nested.
router.get("/:id", async (req, res, next) => {
    try {
        const milestoneResult = await query(
            "SELECT * FROM milestones WHERE milestoneId = $1",
            [req.params.id]
        );
        if (milestoneResult.rowCount === 0) {
            const err = new Error(`Milestone ${req.params.id} not found`);
            err.status = 404;
            throw err;
        }

        const project = await getProjectAccess(milestoneResult.rows[0].projectid);
        assertProjectAccess(project, req.user);

        const tasksResult = await query(
            "SELECT * FROM tasks WHERE milestoneId = $1 ORDER BY dueDate ASC",
            [req.params.id]
        );

        res.json({ ...milestoneResult.rows[0], tasks: tasksResult.rows });
    } catch (err) {
        next(err);
    }
});

module.exports = router;