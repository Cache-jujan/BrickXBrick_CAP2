// F5/F10 shared task submission (taskProgress.js). No database: queries and
// the transaction are fakes, so each rule is checked on its own.
const test = require("node:test");
const assert = require("node:assert/strict");
const { submitTaskProgress, TaskProgressError } = require("../src/lib/taskProgress");

const SM = { id: "sm-1" };
const TASK_ID = "task-1";
const CSID = "csid-1";

function makeDeps({ task = { taskid: TASK_ID, assignedto: SM.id, status: "Pending" }, existing = null, insertError = null } = {}) {
  const calls = { writes: [], uploads: 0 };
  const run = async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
    if (text.startsWith("select * from tasks")) return task ? { rowCount: 1, rows: [task] } : { rowCount: 0, rows: [] };
    if (text.startsWith("select * from task_progress_log")) return existing ? { rowCount: 1, rows: [existing] } : { rowCount: 0, rows: [] };
    if (text.startsWith("select taskid from tasks") && text.includes("for update")) {
      calls.writes.push("lock");
      return { rowCount: 1, rows: [] };
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

test("online path: uploads once, then locks, supersedes the old pending row and inserts Pending Review", async () => {
  const t = makeDeps();
  const { log, replayed } = await submitTaskProgress(input({ uploadPhoto: t.uploadPhoto }), t.deps);
  assert.equal(replayed, false);
  assert.equal(log.reviewstatus, "Pending Review");
  assert.equal(log.photoevidenceurl, "https://r2/tasks/new.jpg");
  assert.equal(t.calls.uploads, 1);
  assert.deepEqual(t.calls.writes, ["lock", "supersede", "insert"]);
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

test("the unique-index race (23505) becomes 409 PENDING_EXISTS; other DB errors pass through", async () => {
  const race = makeDeps({ insertError: Object.assign(new Error("dup"), { code: "23505" }) });
  await rejects(submitTaskProgress(input({ photoUrl: "u" }), race.deps), 409, "PENDING_EXISTS");
  const down = makeDeps({ insertError: Object.assign(new Error("connection lost"), { code: "08006" }) });
  await assert.rejects(() => submitTaskProgress(input({ photoUrl: "u" }), down.deps), /connection lost/);
});

test("the note is optional and stored as null", async () => {
  const t = makeDeps();
  const { log } = await submitTaskProgress(input({ note: undefined, photoUrl: "u" }), t.deps);
  assert.equal(log.note, null);
});
