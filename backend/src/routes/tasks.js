// tasks.js — F3: task listing. F5: task progress submission (two-phase:
// SM submits -> Pending Review -> PM Acknowledges or Flags).
const express = require("express");
const multer = require("multer");
const { query, withTransaction } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { recalcMilestoneProgress } = require("../lib/milestoneProgress");
const { uploadBuffer, putObject } = require("../lib/r2");
const { hasValidMagicBytes } = require("../lib/photoValidation");
const { isUUID } = require("../lib/uuid");
const {
    MAX_DOCUMENT_BYTES,
    MAX_DOCUMENTS_PER_TASK,
    validateDocumentFile,
    sanitizeFileName,
    sha256Hex,
    buildStorageKey,
    documentUrl,
} = require("../lib/taskDocuments");
const { submitTaskProgress, getTaskForUser } = require("../lib/taskProgress");

const router = express.Router();
router.use(requireAuth);

// GET /assigned — tasks assigned to the calling Site Manager.
// D-14: previously task columns only — an SM with tasks on several projects
// couldn't tell them apart. Now joins milestone/project names.
// D-04: previously only surfaced a photo URL for a still-Pending submission
// — a Flagged submission was invisible here, so the SM never knew to
// resubmit. Now surfaces the latest submission's status/reason regardless
// of outcome (Pending Review, Flagged, Acknowledged, or Superseded).
router.get("/assigned", requireRole("Site Manager"), async (req, res, next) => {
    try {
        const result = await query(
            `SELECT t.*,
                    m.name AS milestonename,
                    p.name AS projectname,
                    pending.photoevidenceurl AS pendingphotoevidenceurl,
                    latest.reviewstatus AS latestreviewstatus,
                    latest.reviewreason AS latestreviewreason
               FROM tasks t
               JOIN milestones m ON m.milestoneId = t.milestoneId
               JOIN projects p ON p.projectId = m.projectId
               LEFT JOIN LATERAL (
                    SELECT photoevidenceurl
                      FROM task_progress_log
                     WHERE taskid = t.taskid AND reviewstatus = 'Pending Review'
                     ORDER BY createdat DESC
                     LIMIT 1
               ) pending ON TRUE
               LEFT JOIN LATERAL (
                    SELECT reviewstatus, reviewreason
                      FROM task_progress_log
                     WHERE taskid = t.taskid
                     ORDER BY createdat DESC
                     LIMIT 1
               ) latest ON TRUE
              WHERE t.assignedTo = $1
              ORDER BY t.dueDate ASC`,
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

// Same four checks, same messages, for every route that accepts a task photo.
function assertEvidencePhoto(file) {
    const fail = (message) => {
        const err = new Error(message);
        err.status = 400;
        throw err;
    };
    if (!file) fail("photo is required to submit task completion");
    if (!ALLOWED_PHOTO_TYPES.includes(file.mimetype)) fail("photo must be JPEG or PNG");
    if (!hasValidMagicBytes(file.buffer, file.mimetype)) {
        fail("photo content does not match a valid JPEG or PNG file");
    }
}

// POST /:id/photo — F10: store ONE task photo and return its URL, nothing else.
// An offline-queued submission cannot carry the image inside the JSON sync
// batch, so on reconnect the phone uploads the photo here first, then sends the
// URL through POST /api/sync. Same storage (R2, tasks/<id>/) and the same
// photo checks as POST /:id/progress, which sends its photo in one request.
//
// Request: multipart/form-data, field "photo" (JPEG/PNG, <=10MB)
// Response 201: { photoUrl }
router.post("/:id/photo", requireRole("Site Manager"), upload.single("photo"), async (req, res, next) => {
    try {
        assertEvidencePhoto(req.file);

        const task = await getTaskForUser(req.user, req.params.id);
        if (task.status === "Completed") {
            const err = new Error("This task is already completed and cannot be resubmitted");
            err.status = 409;
            throw err;
        }

        const photoUrl = await uploadBuffer(req.file.buffer, {
            contentType: req.file.mimetype,
            keyPrefix: `tasks/${req.params.id}`,
        });
        res.status(201).json({ photoUrl });
    } catch (err) {
        next(err);
    }
});

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
        assertEvidencePhoto(req.file);

        // Task, ownership, idempotency and Completed checks, the R2 upload and
        // the Pending Review insert all live in lib/taskProgress.js, which the
        // F10 offline sync calls too.
        const { log, replayed } = await submitTaskProgress({
            user: req.user,
            taskId: req.params.id,
            clientSubmissionId,
            note,
            uploadPhoto: () =>
                uploadBuffer(req.file.buffer, {
                    contentType: req.file.mimetype,
                    keyPrefix: `tasks/${req.params.id}`,
                }),
        });

        res.status(replayed ? 200 : 201).json(log);
    } catch (err) {
        next(err);
    }
});

// GET /progress-log — PM's review queue, scoped to projects they manage.
// ?status= filters reviewStatus, defaults to Pending Review.
router.get("/progress-log", requireRole("Project Manager"), async (req, res, next) => {
    try {
        const status = req.query.status || "Pending Review";
        // D-13: previously selected only t.milestoneId — the review card
        // showed a raw UUID with no project, so the PM couldn't tell which
        // project/milestone a submission belonged to without a lookup.
        const result = await query(
            `SELECT l.*, t.taskName, t.milestoneId, m.name AS milestoneName, p.name AS projectName
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

        // D-06: the old check-then-act (read reviewStatus, then UPDATE)
        // let concurrent Acknowledge + Flag both pass the read and both
        // succeed, leaving the log Flagged while the task flipped to
        // Completed. Claim the row atomically — only the request that
        // actually flips Pending Review -> something else proceeds; the
        // other gets 0 rows back and 409s.
        const result = await withTransaction(async (client) => {
            const claim = await client.query(
                `UPDATE task_progress_log
                    SET reviewStatus = $1::varchar,
                        reviewedBy = $2,
                        reviewedAt = NOW(),
                        reviewReason = $3
                  WHERE logId = $4 AND reviewStatus = 'Pending Review'
                  RETURNING *`,
                [
                    decision === "Acknowledge" ? "Acknowledged" : "Flagged",
                    req.user.id,
                    decision === "Flag" ? reason : null,
                    req.params.logId,
                ]
            );
            if (claim.rowCount === 0) {
                const err = new Error("This submission was already reviewed");
                err.status = 409;
                throw err;
            }
            const updatedLog = claim.rows[0];

            let task;
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
                            completedAt = NOW(),
                            lastUpdatedAt = NOW()
                      WHERE taskId = $3
                      RETURNING *`,
                    [updatedLog.photoevidenceurl, updatedLog.submittedby, updatedLog.taskid]
                );
                task = taskUpdate.rows[0];

                await recalcMilestoneProgress(client, log.milestoneid);
            } else {
                const taskResult = await client.query("SELECT * FROM tasks WHERE taskId = $1", [updatedLog.taskid]);
                task = taskResult.rows[0];
            }

            return { log: updatedLog, task };
        });

        res.json(result);
    } catch (err) {
        next(err);
    }
});

// --- #5: Planning-phase task completion ----------------------------------

// task + its milestone's phase/project, for the PM-ownership + phase check.
async function getTaskForCompletion(taskId) {
    const result = await query(
        `SELECT t.*, m.phase AS milestonephase, m.milestoneId AS taskmilestoneid,
                p.projectManagerId
           FROM tasks t
           JOIN milestones m ON m.milestoneId = t.milestoneId
           JOIN projects p ON p.projectId = m.projectId
          WHERE t.taskId = $1`,
        [taskId]
    );
    if (result.rowCount === 0) {
        const err = new Error(`Task ${taskId} not found`);
        err.status = 404;
        throw err;
    }
    return result.rows[0];
}

// PATCH /:id/complete — PM marks a Planning-phase task done. There's no SM
// photo-submission/review flow for Planning work (#5) — it's "Handled by:
// GM/PM" and only the owning PM can close it out, optionally with a note.
// Construction tasks keep going through POST /:id/progress + the PM
// Acknowledge/Flag review above; this route refuses them.
router.patch("/:id/complete", requireRole("Project Manager"), async (req, res, next) => {
    try {
        const { note } = req.body;

        const task = await getTaskForCompletion(req.params.id);

        if (task.projectmanagerid !== req.user.id) {
            const err = new Error("You may only complete tasks on a project you are the Project Manager for");
            err.status = 403;
            throw err;
        }
        if (task.milestonephase !== "Planning") {
            const err = new Error("Only a Planning-phase task can be completed this way — Construction tasks are completed by acknowledging the Site Manager's photo submission");
            err.status = 409;
            throw err;
        }
        if (task.status === "Completed") {
            const err = new Error("This task is already completed");
            err.status = 409;
            throw err;
        }

        const updated = await withTransaction(async (client) => {
            const taskUpdate = await client.query(
                `UPDATE tasks
                    SET status = 'Completed'::varchar,
                        completionPercentage = 100,
                        completedBy = $1,
                        completedAt = NOW(),
                        completionNote = $2
                  WHERE taskId = $3
                  RETURNING *`,
                [req.user.id, note || null, req.params.id]
            );
            await recalcMilestoneProgress(client, task.taskmilestoneid);
            return taskUpdate.rows[0];
        });

        res.json(updated);
    } catch (err) {
        next(err);
    }
});

// --- Planning-task documents ----------------------------------------------
//
// A Planning task is "Handled by GM/PM" and has no photo flow, so the only way
// to show real work was a note. These routes let the GM (any project) or the
// owning PM attach PDF/JPEG/PNG files to a Planning task: a title, a permit, a
// soil report, approved plans. Files live in R2; task_documents holds the
// metadata (migration 042). Completion rules are unchanged: still PM-only.

const documentUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
});

// Own multer wrapper so a too-big file says "file", not "photo" (the handler
// at the bottom of this file is worded for task photos).
function receiveDocument(req, res, next) {
    documentUpload.single("file")(req, res, (err) => {
        if (!err) return next();
        if (err instanceof multer.MulterError) {
            const message = err.code === "LIMIT_FILE_SIZE" ? "file must be 10MB or smaller" : err.message;
            return res.status(400).json({ error: message });
        }
        return next(err);
    });
}

async function getPlanningTaskContext(taskId) {
    if (!isUUID(taskId)) {
        const err = new Error(`Task ${taskId} not found`);
        err.status = 404;
        throw err;
    }
    const result = await query(
        `SELECT t.taskId, t.taskName, t.status,
                m.phase AS milestonephase,
                p.projectManagerId, p.status AS projectstatus
           FROM tasks t
           JOIN milestones m ON m.milestoneId = t.milestoneId
           JOIN projects p ON p.projectId = m.projectId
          WHERE t.taskId = $1`,
        [taskId]
    );
    if (result.rowCount === 0) {
        const err = new Error(`Task ${taskId} not found`);
        err.status = 404;
        throw err;
    }
    return result.rows[0];
}

// GM: any project. PM: only the project they manage.
function assertDocumentAccess(task, user) {
    if (user.role === "General Manager") return;
    if (user.role === "Project Manager" && task.projectmanagerid === user.id) return;
    const err = new Error("You do not have access to this task's documents");
    err.status = 403;
    throw err;
}

function assertPlanningTask(task) {
    if (task.milestonephase !== "Planning") {
        const err = new Error("Documents can only be attached to Planning-phase tasks");
        err.status = 409;
        throw err;
    }
}

// Adding or removing is only allowed while the task is open on a live
// project. Reading is always allowed.
function assertDocumentsEditable(task) {
    if (!["Draft", "Active"].includes(task.projectstatus)) {
        const err = new Error(`This project is ${task.projectstatus} — its documents can no longer be changed`);
        err.status = 409;
        throw err;
    }
    if (task.status === "Completed") {
        const err = new Error("This task is already completed — its documents are locked");
        err.status = 409;
        throw err;
    }
}

const DOCUMENT_COLUMNS = `d.documentId   AS "documentID",
                    d.taskId       AS "taskID",
                    d.fileName     AS "fileName",
                    d.contentType  AS "contentType",
                    d.sizeBytes    AS "sizeBytes",
                    d.uploadedAt   AS "uploadedAt",
                    d.uploadedBy   AS "uploadedBy",
                    u.name         AS "uploadedByName"`;

// GET /:id/documents — the task's live documents, oldest first.
router.get("/:id/documents", requireRole("General Manager", "Project Manager"), async (req, res, next) => {
    try {
        const task = await getPlanningTaskContext(req.params.id);
        assertDocumentAccess(task, req.user);
        assertPlanningTask(task);

        const result = await query(
            `SELECT ${DOCUMENT_COLUMNS}
               FROM task_documents d
               LEFT JOIN users u ON u.userId = d.uploadedBy
              WHERE d.taskId = $1 AND d.deletedAt IS NULL
              ORDER BY d.uploadedAt ASC, d.documentId ASC`,
            [req.params.id]
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// POST /:id/documents — attach one file (form field "file").
router.post("/:id/documents", requireRole("General Manager", "Project Manager"), receiveDocument, async (req, res, next) => {
    try {
        const task = await getPlanningTaskContext(req.params.id);
        assertDocumentAccess(task, req.user);
        assertPlanningTask(task);
        assertDocumentsEditable(task);

        const { contentType, ext } = validateDocumentFile(req.file);

        const count = await query(
            "SELECT COUNT(*) AS n FROM task_documents WHERE taskId = $1 AND deletedAt IS NULL",
            [req.params.id]
        );
        if (Number(count.rows[0].n) >= MAX_DOCUMENTS_PER_TASK) {
            const err = new Error(`A task can hold at most ${MAX_DOCUMENTS_PER_TASK} documents — remove one first`);
            err.status = 409;
            throw err;
        }

        const storageKey = buildStorageKey(req.params.id, ext);
        await putObject(storageKey, req.file.buffer, contentType);

        const inserted = await query(
            `INSERT INTO task_documents (taskId, uploadedBy, fileName, contentType, sizeBytes, sha256, storageKey)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING documentId AS "documentID", taskId AS "taskID", fileName AS "fileName",
                       contentType AS "contentType", sizeBytes AS "sizeBytes",
                       uploadedAt AS "uploadedAt", uploadedBy AS "uploadedBy"`,
            [
                req.params.id,
                req.user.id,
                sanitizeFileName(req.file.originalname, ext),
                contentType,
                req.file.buffer.length,
                sha256Hex(req.file.buffer),
                storageKey,
            ]
        );
        res.status(201).json({ ...inserted.rows[0], uploadedByName: req.user.name });
    } catch (err) {
        next(err);
    }
});

// GET /:id/documents/:docId/download — { url, fileName }. The client opens
// the url. Returned from an authenticated call so that making the bucket
// private later only changes documentUrl() in lib/taskDocuments.js.
router.get("/:id/documents/:docId/download", requireRole("General Manager", "Project Manager"), async (req, res, next) => {
    try {
        const task = await getPlanningTaskContext(req.params.id);
        assertDocumentAccess(task, req.user);
        assertPlanningTask(task);

        const notFound = () => {
            const err = new Error("Document not found");
            err.status = 404;
            return err;
        };
        if (!isUUID(req.params.docId)) throw notFound();

        const result = await query(
            `SELECT fileName, storageKey
               FROM task_documents
              WHERE documentId = $1 AND taskId = $2 AND deletedAt IS NULL`,
            [req.params.docId, req.params.id]
        );
        if (result.rowCount === 0) throw notFound();

        const row = result.rows[0];
        res.json({ url: documentUrl(row.storagekey), fileName: row.filename });
    } catch (err) {
        next(err);
    }
});

// DELETE /:id/documents/:docId — soft delete (the row stays, marked deleted).
router.delete("/:id/documents/:docId", requireRole("General Manager", "Project Manager"), async (req, res, next) => {
    try {
        const task = await getPlanningTaskContext(req.params.id);
        assertDocumentAccess(task, req.user);
        assertPlanningTask(task);
        assertDocumentsEditable(task);

        const notFound = () => {
            const err = new Error("Document not found");
            err.status = 404;
            return err;
        };
        if (!isUUID(req.params.docId)) throw notFound();

        const result = await query(
            `UPDATE task_documents
                SET deletedAt = NOW(), deletedBy = $3
              WHERE documentId = $1 AND taskId = $2 AND deletedAt IS NULL
              RETURNING documentId`,
            [req.params.docId, req.params.id, req.user.id]
        );
        if (result.rowCount === 0) throw notFound();

        res.status(204).end();
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