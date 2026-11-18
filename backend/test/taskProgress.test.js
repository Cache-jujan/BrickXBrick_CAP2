// F5/F10 shared task submission (taskProgress.js). No database: queries and
// the transaction are fakes, so each rule is checked on its own.
const test = require("node:test");
const assert = require("node:assert/strict");
const { submitTaskProgress, TaskProgressError, taskReviewNotice } = require("../src/lib/taskProgress");

const SM = { id: "sm-1" };
const TASK_ID = "task-1";
const CSID = "csid-1";

function makeDeps({ task = { taskid: TASK_ID, assignedto: SM.id, status: "Pending" }, existing = null, insertError = null, pending = false, pendingUnderLock = false, notifyError = null, gateOpen = false, phase = "Construction", requirementcode = null } = {}) {
  const calls = { writes: [], uploads: 0, pendingChecks: 0, notifications: [], savepoints: [] };
  let locked = false;
  const run = async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
    if (text.startsWith("select * from tasks")) return task ? { rowCount: 1, rows: [task] } : { rowCount: 0, rows: [] };
    if (text.startsWith("select m.phase, t.requirementcode")) {
      return { rowCount: 1, rows: [{ phase, requirementcode, gateopen: gateOpen }] };
    }
    if (text.startsWith("select * from task_progress_log")) return existing ? { rowCount: 1, rows: [existing] } : { rowCount: 0, rows: [] };
    if (text.startsWith("select taskid from tasks") && text.includes("for update")) {
      calls.writes.push("lock");
      locked = true;
      return { rowCount: 1, rows: [] };
    }
    if (text.startsWith("select 1 from task_progress_log")) {
      calls.pendingChecks += 1;
      const isPending = pending || (locked && pendingUnderLock);
      return { rowCount: isPending ? 1 : 0, rows: isPending ? [{}] : [] };
    }
    if (text.startsWith("update task_progress_log")) {
      calls.writes.push("supersede");
      return { rowCount: 0, rows: [] };
    }
    if (text.startsWith("insert into task_progress_log")) {
      if (insertError) throw insertError;
      calls.writes.push("insert");
      const [taskid, submittedby, clientsubmissionid, photoevidenceurl, note] = params;
      return { rowCount: 1, rows: [{ taskid, submittedby, clientsubmissionid, photoevidenceurl, note, reviewstatus: "Pending Review" }] };
    }
    if (text.startsWith("select t.taskname")) {
      return { rowCount: 1, rows: [{ taskname: "Pour slab", projectname: "Tower A", projectmanagerid: "pm-1" }] };
    }
    if (text.startsWith("savepoint") || text.startsWith("release savepoint") || text.startsWith("rollback to savepoint")) {
      calls.savepoints.push(text.split(" ")[0] === "savepoint" ? "savepoint" : text.split(" ").slice(0, 2).join(" "));
      return { rowCount: 0, rows: [] };
    }
    if (text.startsWith("insert into notifications")) {
      if (notifyError) throw notifyError;
      calls.notifications.push(params);
      return { rowCount: 1, rows: [] };
    }
    throw new Error("unexpected query: " + text);
  };
  return {
    calls,
    deps: { query: run, withTransaction: async (fn) => fn({ query: run }) },
    uploadPhoto: async () => {
      calls.uploads += 1;
      return "https://r2/tasks/new.jpg";
    },
  };
}

const input = (extra = {}) => ({ user: SM, taskId: TASK_ID, clientSubmissionId: CSID, note: "done", ...extra });

async function rejects(promise, status, code) {
  await assert.rejects(promise, (e) => e instanceof TaskProgressError && e.status === status && e.code === code);
}

test("online path: uploads once, then locks, re-checks and inserts Pending Review (nothing is superseded any more)", async () => {
  const t = makeDeps();
  const { log, replayed } = await submitTaskProgress(input({ uploadPhoto: t.uploadPhoto }), t.deps);
  assert.equal(replayed, false);
  assert.equal(log.reviewstatus, "Pending Review");
  assert.equal(log.photoevidenceurl, "https://r2/tasks/new.jpg");
  assert.equal(t.calls.uploads, 1);
  assert.deepEqual(t.calls.writes, ["lock", "insert"]);
  assert.equal(t.calls.pendingChecks, 2); // before the upload, and again under the lock
});

test("the project's PM is told a photo is waiting for review, in the same transaction", async () => {
  const t = makeDeps();
  await submitTaskProgress(input({ user: { id: "sm-1", name: "Sam Site" }, uploadPhoto: t.uploadPhoto }), t.deps);
  assert.equal(t.calls.notifications.length, 1);
  const [recipient, type, entityType, entityId, message] = t.calls.notifications[0];
  assert.equal(recipient, "pm-1");
  assert.equal(type, "TaskSubmitted");
  assert.equal(entityType, "Task");
  assert.equal(entityId, TASK_ID);
  assert.match(message, /Sam Site sent a photo for "Pour slab" \(Tower A\)/);
});

test("a failed notification (for example migration 060 not run yet) never fails the submission", async () => {
  const t = makeDeps({ notifyError: new Error("violates check constraint notifications_type_check") });
  const { log, replayed } = await submitTaskProgress(input({ uploadPhoto: t.uploadPhoto }), t.deps);
  assert.equal(replayed, false);
  assert.equal(log.reviewstatus, "Pending Review");
  assert.deepEqual(t.calls.savepoints, ["savepoint", "rollback to"]);
});

test("a replay of a saved submission does not notify the PM again", async () => {
  const original = { taskid: TASK_ID, submittedby: SM.id, clientsubmissionid: CSID, reviewstatus: "Pending Review" };
  const t = makeDeps({ existing: original });
  await submitTaskProgress(input({ uploadPhoto: t.uploadPhoto }), t.deps);
  assert.equal(t.calls.notifications.length, 0);
});

test("sync path: a photoUrl that is already stored is used and nothing is uploaded", async () => {
  const t = makeDeps();
  const { log } = await submitTaskProgress(input({ photoUrl: "https://r2/tasks/already.jpg" }), t.deps);
  assert.equal(log.photoevidenceurl, "https://r2/tasks/already.jpg");
  assert.equal(t.calls.uploads, 0);
});

test("unknown task: 404 TASK_NOT_FOUND", async () => {
  const t = makeDeps({ task: null });
  await rejects(submitTaskProgress(input({ uploadPhoto: t.uploadPhoto }), t.deps), 404, "TASK_NOT_FOUND");
});

test("task assigned to someone else: 403 TASK_NOT_YOURS, no upload, no write", async () => {
  const t = makeDeps({ task: { taskid: TASK_ID, assignedto: "sm-2", status: "Pending" } });
  await rejects(submitTaskProgress(input({ uploadPhoto: t.uploadPhoto }), t.deps), 403, "TASK_NOT_YOURS");
  assert.equal(t.calls.uploads, 0);
  assert.deepEqual(t.calls.writes, []);
});

test("same clientSubmissionId, same task and user: returns the original row, no upload, no write", async () => {
  const original = { taskid: TASK_ID, submittedby: SM.id, clientsubmissionid: CSID, reviewstatus: "Acknowledged" };
  const t = makeDeps({ existing: original });
  const { log, replayed } = await submitTaskProgress(input({ uploadPhoto: t.uploadPhoto }), t.deps);
  assert.equal(replayed, true);
  assert.equal(log, original);
  assert.equal(t.calls.uploads, 0);
  assert.deepEqual(t.calls.writes, []);
});

test("a replay of an already-completed task still returns the original row (not a 409)", async () => {
  const t = makeDeps({
    task: { taskid: TASK_ID, assignedto: SM.id, status: "Completed" },
    existing: { taskid: TASK_ID, submittedby: SM.id, clientsubmissionid: CSID },
  });
  assert.equal((await submitTaskProgress(input({ uploadPhoto: t.uploadPhoto }), t.deps)).replayed, true);
});

test("clientSubmissionId already used by a different task or user: 409 CLIENT_ID_IN_USE", async () => {
  const t = makeDeps({ existing: { taskid: "other-task", submittedby: SM.id, clientsubmissionid: CSID } });
  await rejects(submitTaskProgress(input({ uploadPhoto: t.uploadPhoto }), t.deps), 409, "CLIENT_ID_IN_USE");
});

test("completed task: 409 TASK_CLOSED, no upload", async () => {
  const t = makeDeps({ task: { taskid: TASK_ID, assignedto: SM.id, status: "Completed" } });
  await rejects(submitTaskProgress(input({ uploadPhoto: t.uploadPhoto }), t.deps), 409, "TASK_CLOSED");
  assert.equal(t.calls.uploads, 0);
});

test("the unique-index race (23505) becomes 409 AWAITING_REVIEW; other DB errors pass through", async () => {
  const race = makeDeps({ insertError: Object.assign(new Error("dup"), { code: "23505" }) });
  await rejects(submitTaskProgress(input({ photoUrl: "u" }), race.deps), 409, "AWAITING_REVIEW");
  const down = makeDeps({ insertError: Object.assign(new Error("connection lost"), { code: "08006" }) });
  await assert.rejects(() => submitTaskProgress(input({ photoUrl: "u" }), down.deps), /connection lost/);
});

test("the note is optional and stored as null", async () => {
  const t = makeDeps();
  const { log } = await submitTaskProgress(input({ note: undefined, photoUrl: "u" }), t.deps);
  assert.equal(log.note, null);
});

// one submission waits for review at a time (Site Manager)

test("a submission already waiting for review blocks a new one: 409 AWAITING_REVIEW, no upload, no write", async () => {
  const t = makeDeps({ pending: true });
  await assert.rejects(
    submitTaskProgress(input({ uploadPhoto: t.uploadPhoto }), t.deps),
    (e) => e instanceof TaskProgressError && e.status === 409 && e.code === "AWAITING_REVIEW" && /flag it/.test(e.message)
  );
  assert.equal(t.calls.uploads, 0);
  assert.deepEqual(t.calls.writes, []);
});

test("another phone submitted in between: the check under the lock refuses it, nothing inserted", async () => {
  const t = makeDeps({ pendingUnderLock: true });
  await rejects(submitTaskProgress(input({ photoUrl: "u" }), t.deps), 409, "AWAITING_REVIEW");
  assert.deepEqual(t.calls.writes, ["lock"]);
});

test("a replay of the submission that is waiting still returns it (not blocked by itself)", async () => {
  const original = { taskid: TASK_ID, submittedby: SM.id, clientsubmissionid: CSID, reviewstatus: "Pending Review" };
  const t = makeDeps({ existing: original, pending: true });
  const { replayed } = await submitTaskProgress(input({ uploadPhoto: t.uploadPhoto }), t.deps);
  assert.equal(replayed, true);
});

test("review notice: accepted says the task is complete", () => {
  const n = taskReviewNotice({ decision: "Acknowledge", taskName: "Gather stone" });
  assert.equal(n.type, "TaskAcknowledged");
  assert.match(n.message, /"Gather stone" was accepted/);
});

test("review notice: flagged carries the PM's reason", () => {
  const n = taskReviewNotice({ decision: "Flag", taskName: "Gather stone", reason: " Photo is blurry " });
  assert.equal(n.type, "TaskFlagged");
  assert.equal(n.message, 'Your photo for "Gather stone" was flagged: Photo is blurry. Please submit a new photo.');
});

test("procurement gate: other Construction work is refused with 409 PROCUREMENT_GATE while the gate is open, before any upload", async () => {
  const { deps, calls, uploadPhoto } = makeDeps({ gateOpen: true });
  await rejects(submitTaskProgress(input({ uploadPhoto }), deps), 409, "PROCUREMENT_GATE");
  assert.equal(calls.uploads, 0);
  assert.deepEqual(calls.writes, []);
});

test("procurement gate: the gate task itself, a Planning task, or a done gate are not blocked", async () => {
  for (const extra of [
    { gateOpen: true, requirementcode: "GATE-PROC-RECEIVED" },
    { gateOpen: true, phase: "Planning" },
    { gateOpen: false },
  ]) {
    const { deps, uploadPhoto } = makeDeps(extra);
    const { log } = await submitTaskProgress(input({ uploadPhoto }), deps);
    assert.equal(log.reviewstatus, "Pending Review");
  }
});
