// tasks.js — F3: task listing. F5: task progress submission (two-phase:
// SM submits -> Pending Review -> PM Acknowledges or Flags).
const express = require("express");
const multer = require("multer");
const { query, withTransaction } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { recalcMilestoneProgress } = require("../lib/milestoneProgress");
const { uploadBuffer } = require("../lib/r2");

const router = express.Router();
router.use(requireAuth);

// GET /assigned — tasks assigned to the calling Site Manager.
router.get("/assigned", requireRole("Site Manager"), async (req, res, next) => {
    try {
        const result = await query(
            "SELECT * FROM tasks WHERE assignedTo = $1 ORDER BY dueDate ASC",
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// --- F5: task progress submission ---------------------------------------

const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png"];
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PHOTO_BYTES },
});

async function getTaskForSubmission(taskId) {
    const result = await query("SELECT * FROM tasks WHERE taskId = $1", [taskId]);
    if (result.rowCount === 0) {
        const err = new Error(`Task ${taskId} not found`);
        err.status = 404;
        throw err;
    }
    return result.rows[0];
}

// task + its milestone's project, for the PM-ownership check on review.
async function getLogForReview(logId) {
    const result = await query(
        `SELECT l.*, t.milestoneId, t.taskName, t.status AS taskStatus,
                m.projectId, p.projectManagerId
           FROM task_progress_log l
           JOIN tasks t ON t.taskId = l.taskId
           JOIN milestones m ON m.milestoneId = t.milestoneId
           JOIN projects p ON p.projectId = m.projectId
          WHERE l.logId = $1`,
        [logId]
    );
    if (result.rowCount === 0) {
        const err = new Error(`Progress log entry ${logId} not found`);
        err.status = 404;
        throw err;
    }
    return result.rows[0];
}

// POST /:id/progress — Site Manager assigned to the task marks it done.
// Tasks are binary (WBS leaf items) -- no percentage in the payload. Photo
// is required; the task row is NOT touched here, only on PM Acknowledge.
//
// Request: multipart/form-data
//   clientSubmissionId  UUID, required — idempotency key, see migration
//                        010 comment. Generated on-device; F10 must carry
//                        the SAME value through a queued-then-replayed
//                        sync, or this dedup does nothing for them.
//   note                string, optional — context on THIS submission
//                        only (e.g. "photo's dark, couldn't retake
//                        on-site"). NOT the issue-reporting mechanism —
//                        that's a separate POST /api/tickets with
//                        ticketType: "Report", decoupled from this route.
//   photo               file, required — JPEG/PNG, <=10MB
router.post("/:id/progress", requireRole("Site Manager"), upload.single("photo"), async (req, res, next) => {
    try {
        const { clientSubmissionId, note } = req.body;

        if (!clientSubmissionId) {
            const err = new Error("clientSubmissionId is required (idempotency key for offline replay)");
            err.status = 400;
            throw err;
        }
        if (!req.file) {
            const err = new Error("photo is required to submit task completion");
            err.status = 400;
            throw err;
        }
        if (!ALLOWED_PHOTO_TYPES.includes(req.file.mimetype)) {
            const err = new Error("photo must be JPEG or PNG");
            err.status = 400;
            throw err;
        }

        const task = await getTaskForSubmission(req.params.id);

        if (task.assignedto !== req.user.id) {
            const err = new Error("You may only submit progress on a task assigned to you");
            err.status = 403;
            throw err;
        }
        if (task.status === "Completed") {
            const err = new Error("This task is already completed and cannot be resubmitted");
            err.status = 409;
            throw err;
        }

        // Idempotency check BEFORE the R2 upload — a replayed sync call
        // should not re-upload a duplicate photo, it should just hand back
        // whatever already landed from the first attempt.
        const existing = await query(
            "SELECT * FROM task_progress_log WHERE clientSubmissionId = $1",
            [clientSubmissionId]
        );
        if (existing.rowCount > 0) {
            return res.status(200).json(existing.rows[0]);
        }

        const photoEvidenceURL = await uploadBuffer(req.file.buffer, {
            contentType: req.file.mimetype,
            keyPrefix: `tasks/${req.params.id}`,
        });

        const logEntry = await withTransaction(async (client) => {
            // Supersede any prior pending entry rather than blocking —
            // resubmission mid-review is allowed, not queued.
            await client.query(
                `UPDATE task_progress_log
                    SET reviewStatus = 'Superseded'::varchar
                  WHERE taskId = $1 AND reviewStatus = 'Pending Review'`,
                [req.params.id]
            );

            const insertResult = await client.query(
                `INSERT INTO task_progress_log
                    (taskId, submittedBy, clientSubmissionId, photoEvidenceURL, note)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [req.params.id, req.user.id, clientSubmissionId, photoEvidenceURL, note || null]
            );
            return insertResult.rows[0];
        });

        res.status(201).json(logEntry);
    } catch (err) {
        next(err);
    }
});

// GET /progress-log — PM's review queue, scoped to projects they manage.
// ?status= filters reviewStatus, defaults to Pending Review.
router.get("/progress-log", requireRole("Project Manager"), async (req, res, next) => {
    try {
        const status = req.query.status || "Pending Review";
        const result = await query(
            `SELECT l.*, t.taskName, t.milestoneId
               FROM task_progress_log l
               JOIN tasks t ON t.taskId = l.taskId
               JOIN milestones m ON m.milestoneId = t.milestoneId
               JOIN projects p ON p.projectId = m.projectId
              WHERE p.projectManagerId = $1 AND l.reviewStatus = $2
              ORDER BY l.createdAt ASC`,
            [req.user.id, status]
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// PATCH /progress-log/:logId/review — PM only, must own the project.
// decision: "Acknowledge" -> task flips to Completed, milestone recalcs.
//           "Flag" (requires reason) -> task untouched, SM must resubmit.
router.patch("/progress-log/:logId/review", requireRole("Project Manager"), async (req, res, next) => {
    try {
        const { decision, reason } = req.body;

        if (decision !== "Acknowledge" && decision !== "Flag") {
            const err = new Error('decision must be "Acknowledge" or "Flag"');
            err.status = 400;
            throw err;
        }
        if (decision === "Flag" && !reason) {
            const err = new Error("reason is required when flagging a submission");
            err.status = 400;
            throw err;
        }

        const log = await getLogForReview(req.params.logId);

        if (log.projectmanagerid !== req.user.id) {
            const err = new Error("You may only review submissions on projects you manage");
            err.status = 403;
            throw err;
        }
        if (log.reviewstatus !== "Pending Review") {
            const err = new Error(`This submission was already reviewed (status: ${log.reviewstatus})`);
            err.status = 409;
            throw err;
        }

        const result = await withTransaction(async (client) => {
            let task = null;

            if (decision === "Acknowledge") {
                // updatedBy reflects the SM who did the work, not the PM
                // reviewing it — reviewedBy on the log row already tracks
                // the PM's action separately.
                const taskUpdate = await client.query(
                    `UPDATE tasks
                        SET completionPercentage = 100,
                            status = 'Completed'::varchar,
                            photoEvidenceURL = $1,
                            updatedBy = $2,
                            lastUpdatedAt = NOW()
                      WHERE taskId = $3
                      RETURNING *`,
                    [log.photoevidenceurl, log.submittedby, log.taskid]
                );
                task = taskUpdate.rows[0];

                await client.query(
                    `UPDATE task_progress_log
                        SET reviewStatus = 'Acknowledged'::varchar, reviewedBy = $1, reviewedAt = NOW()
                      WHERE logId = $2`,
                    [req.user.id, req.params.logId]
                );

                await recalcMilestoneProgress(client, log.milestoneid);
            } else {
                await client.query(
                    `UPDATE task_progress_log
                        SET reviewStatus = 'Flagged'::varchar, reviewedBy = $1, reviewedAt = NOW(), reviewReason = $2
                      WHERE logId = $3`,
                    [req.user.id, reason, req.params.logId]
                );

                const taskResult = await client.query("SELECT * FROM tasks WHERE taskId = $1", [log.taskid]);
                task = taskResult.rows[0];
            }

            const logResult = await client.query("SELECT * FROM task_progress_log WHERE logId = $1", [req.params.logId]);
            return { log: logResult.rows[0], task };
        });

        res.json(result);
    } catch (err) {
        next(err);
    }
});

// multer errors (e.g. file too large) are raised via next(err) before ever
// reaching the handler above, so they need their own handler here.
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        const message = err.code === "LIMIT_FILE_SIZE" ? "photo must be 10MB or smaller" : err.message;
        return res.status(400).json({ error: message });
    }
    next(err);
});

module.exports = router;