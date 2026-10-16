// taskProgress.js — F5 task progress submission, shared by the online route
// (POST /api/tasks/:id/progress) and the F10 offline sync (routes/sync.js).
//
// One rule set: an offline submission is only a delivery delay, so both paths
// call submitTaskProgress and cannot drift apart. It writes a Pending Review
// row in task_progress_log and nothing else: the task row, the milestone
// progress and the variance alert change only when the PM Acknowledges.
//
// Failures throw TaskProgressError with an HTTP-style `status` (the route
// returns it as is) and a stable `code` (sync maps it to a reject code).

const db = require("./db");
const r2 = require("./r2");

class TaskProgressError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// The task, if it exists and is assigned to this user. 404 / 403 otherwise.
async function getTaskForUser(user, taskId, query = db.query) {
  const result = await query("SELECT * FROM tasks WHERE taskId = $1", [taskId]);
  if (result.rowCount === 0) {
    throw new TaskProgressError(404, "TASK_NOT_FOUND", `Task ${taskId} not found`);
  }
  const task = result.rows[0];
  if (task.assignedto !== user.id) {
    throw new TaskProgressError(403, "TASK_NOT_YOURS", "You may only submit progress on a task assigned to you");
  }
  return task;
}

/**
 * submitTaskProgress(input, deps?)
 *   input.user                 { id }  the Site Manager submitting
 *   input.taskId
 *   input.clientSubmissionId   idempotency key (made on the device)
 *   input.note                 optional text
 *   input.photoUrl             already-stored photo URL (sync path), or
 *   input.uploadPhoto          async () => url, called only once every check
 *                              has passed (online path: never uploads a replay)
 *   deps                       { query, withTransaction } for tests
 * Returns { log, replayed }. replayed is true when this clientSubmissionId
 * was already saved by the same user for the same task.
 */
async function submitTaskProgress(input, deps = {}) {
  const query = deps.query || db.query;
  const withTransaction = deps.withTransaction || db.withTransaction;
  const { user, taskId, clientSubmissionId, note, photoUrl, uploadPhoto } = input;

  const task = await getTaskForUser(user, taskId, query);

  // D-05/D-15: scope the idempotency match to this task + this submitter, run
  // it before the Completed check (a replay of an already-acknowledged
  // submission returns the original row, not a 409) and before any upload (a
  // replayed sync call never re-uploads).
  const existing = await query("SELECT * FROM task_progress_log WHERE clientSubmissionId = $1", [clientSubmissionId]);
  if (existing.rowCount > 0) {
    const log = existing.rows[0];
    if (log.taskid === taskId && log.submittedby === user.id) {
      return { log, replayed: true };
    }
    throw new TaskProgressError(409, "CLIENT_ID_IN_USE", "clientSubmissionId is already in use by a different task or submitter");
  }

  if (task.status === "Completed") {
    throw new TaskProgressError(409, "TASK_CLOSED", "This task is already completed and cannot be resubmitted");
  }

  const photoEvidenceURL = photoUrl || (await uploadPhoto());

  try {
    const log = await withTransaction(async (client) => {
      // D-06: lock the task row so two concurrent submits serialize instead of
      // both reading "no pending row yet". task_progress_log_one_pending_per_task
      // (migration 021) is the DB-level backstop if they race past this anyway.
      await client.query("SELECT taskId FROM tasks WHERE taskId = $1 FOR UPDATE", [taskId]);

      // Supersede any prior pending entry rather than blocking: resubmission
      // mid-review is allowed, not queued.
      await client.query(
        `UPDATE task_progress_log
            SET reviewStatus = 'Superseded'::varchar
          WHERE taskId = $1 AND reviewStatus = 'Pending Review'`,
        [taskId]
      );

      const insertResult = await client.query(
        `INSERT INTO task_progress_log
            (taskId, submittedBy, clientSubmissionId, photoEvidenceURL, note)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [taskId, user.id, clientSubmissionId, photoEvidenceURL, note || null]
      );
      return insertResult.rows[0];
    });
    return { log, replayed: false };
  } catch (error) {
    if (error.code === "23505") {
      throw new TaskProgressError(409, "PENDING_EXISTS", "A submission is already pending review for this task");
    }
    throw error;
  }
}

/**
 * taskPhotoExists(url, taskId, deps?) -> true | false
 *
 * Is `url` a photo this server stored for THIS task? Only objects under
 * tasks/<taskId>/ in our bucket count, so a queued update cannot attach
 * another task's photo or an outside link. false means "confirmed missing or
 * not ours". If storage cannot be checked (timeout, network) this THROWS: the
 * sync keeps the item pending and retries, it never rejects on a failed check.
 */
async function taskPhotoExists(url, taskId, deps = {}) {
  const keyFromUrl = deps.keyFromPublicUrl || r2.keyFromPublicUrl;
  const objectExists = deps.objectExists || r2.objectExists;
  const key = keyFromUrl(url);
  if (!key || !key.startsWith(`tasks/${taskId}/`)) return false;
  return objectExists(key);
}

module.exports = { submitTaskProgress, getTaskForUser, taskPhotoExists, TaskProgressError };
