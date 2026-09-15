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
        "SELECT projectId, projectManagerId, siteManagerId FROM projects WHERE projectId = $1",
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
    return project;
}

async function getMilestoneWithProject(milestoneId) {
    const result = await query(
        `SELECT m.*, p.projectManagerId, p.siteManagerId
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
        const { projectID, name, dueDate } = req.body;

        if (!projectID || !name || !dueDate) {
            const err = new Error("projectID, name, and dueDate are required");
            err.status = 400;
            throw err;
        }

        await getOwnedProject(projectID, req.user.id);

        const result = await query(
            `INSERT INTO milestones (projectId, createdBy, name, dueDate)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [projectID, req.user.id, name, dueDate]
        );

        res.status(201).json(result.rows[0]);
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