// milestones.js — F3: milestone + task creation, PM-owned only.
const express = require("express");
const { query, withTransaction } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { recalcMilestoneProgress } = require("../lib/milestoneProgress");

const router = express.Router();
router.use(requireAuth);

async function getOwnedProject(projectId, userId) {
    const result = await query(
        "SELECT projectId, projectManagerId, siteManagerId, status FROM projects WHERE projectId = $1",
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
    if (project.status !== "Active") {
        const err = new Error(`This project is ${project.status}, not Active — milestones and tasks cannot be created on it`);
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
        `SELECT m.*, p.projectManagerId, p.siteManagerId, p.status AS projectStatus
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

        if (!projectID || !name || !dueDate) {
            const err = new Error("projectID, name, and dueDate are required");
            err.status = 400;
            throw err;
        }

        await getOwnedProject(projectID, req.user.id);

        const milestone = await withTransaction(async (client) => {
            const insertResult = await client.query(
                `INSERT INTO milestones (projectId, createdBy, name, dueDate)
                 VALUES ($1, $2, $3, $4)
                 RETURNING *`,
                [projectID, req.user.id, name, dueDate]
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

        res.status(201).json(milestone);
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

// POST /:id/tasks — PM creates a task under a milestone they own, assigned
// to that project's Site Manager (schema is 1 SM per project — no open pick).
router.post("/:id/tasks", requireRole("Project Manager"), async (req, res, next) => {
    try {
        const { taskName, dueDate } = req.body;

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
        if (milestone.projectstatus !== "Active") {
            const err = new Error(`This project is ${milestone.projectstatus}, not Active — tasks cannot be created on it`);
            err.status = 409;
            throw err;
        }
        if (!milestone.sitemanagerid) {
            const err = new Error("This project has no Site Manager assigned yet — assign one before creating tasks");
            err.status = 400;
            throw err;
        }

        const task = await withTransaction(async (client) => {
            const insertResult = await client.query(
                `INSERT INTO tasks (milestoneId, assignedTo, taskName, dueDate)
                 VALUES ($1, $2, $3, $4)
                 RETURNING *`,
                [req.params.id, milestone.sitemanagerid, taskName, dueDate]
            );
            const newTask = insertResult.rows[0];

            // A new task starts at 0% and shifts the milestone's average —
            // recalc now, not just when future progress updates land (F5).
            await recalcMilestoneProgress(client, req.params.id);

            // D-16: UC-03-01 step 5 says the system notifies the assigned
            // SM. Previously the SM only found out by refreshing their list.
            await client.query(
                `INSERT INTO notifications (recipientId, type, relatedEntityType, relatedEntityId, message)
                 VALUES ($1, 'TaskAssigned', 'Task', $2, $3)`,
                [milestone.sitemanagerid, newTask.taskid, `You were assigned a new task: "${taskName}" — due ${new Date(dueDate).toDateString()}.`]
            );

            return newTask;
        });

        res.status(201).json(task);
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