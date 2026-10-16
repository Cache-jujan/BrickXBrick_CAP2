// F10 offline queues (lib/sync/db.js): the 100-entry / 72-hour rule across both
// queues, one pending update per task, and the status life cycle.
// Run from mobile/:  npm test   (Node 22.7+; uses the built-in node:sqlite)
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
const shim = await import("./expo-sqlite-shim.mjs");
const q = await import("../db.js");

const HOUR = 60 * 60 * 1000;
let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const task = (taskId, extra = {}) => ({ updateId: uid(), taskId, userId: "sm-1", photoPath: `/docs/${taskId}-${n}.jpg`, note: "n", ...extra });
const expense = () => q.queueExpense(uid(), { vendorName: "V", amount: 1 });

function fresh() {
  shim.resetShim();
  q.initDb();
}
const backdate = (table, column, hours) =>
  shim.rawDb().exec(`UPDATE ${table} SET ${column} = '${new Date(Date.now() - hours * HOUR).toISOString()}'`);

// ---- the pure rule --------------------------------------------------------------

test("evaluateEnqueue: under both limits is allowed", () => {
  assert.deepEqual(q.evaluateEnqueue({ pendingCount: 99, oldestCreatedAt: new Date().toISOString() }).allowed, true);
  assert.equal(q.evaluateEnqueue({ pendingCount: 0, oldestCreatedAt: null }).allowed, true);
});

test("evaluateEnqueue: the 100th is allowed, the 101st is blocked (LIMIT)", () => {
  assert.equal(q.evaluateEnqueue({ pendingCount: 99, oldestCreatedAt: null }).allowed, true);
  const blocked = q.evaluateEnqueue({ pendingCount: 100, oldestCreatedAt: null });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "LIMIT");
  assert.match(blocked.message, /100/);
});

test("evaluateEnqueue: oldest entry just under 72h is fine, just over is STALE", () => {
  const now = Date.parse("2026-10-16T00:00:00Z");
  const at = (h) => new Date(now - h * HOUR).toISOString();
  assert.equal(q.evaluateEnqueue({ pendingCount: 1, oldestCreatedAt: at(71.9), now }).allowed, true);
  const stale = q.evaluateEnqueue({ pendingCount: 1, oldestCreatedAt: at(72.1), now });
  assert.equal(stale.allowed, false);
  assert.equal(stale.reason, "STALE");
  assert.match(stale.message, /72 hours/);
});

// ---- both queues share one count ------------------------------------------------------

test("the 101st entry is blocked, counting expenses and task updates together", () => {
  fresh();
  for (let i = 0; i < 60; i++) assert.equal(expense(), true);
  for (let i = 0; i < 40; i++) assert.equal(q.queueTaskUpdate(task(`task-${i}`)).queued, true);
  assert.equal(q.getPendingCount(), 100);
  assert.equal(q.getPendingExpenseCount(), 60);
  assert.equal(q.getPendingTaskUpdateCount(), 40);

  assert.equal(expense(), false); // 101st, an expense
  const blocked = q.queueTaskUpdate(task("task-new")); // 101st, a task update
  assert.equal(blocked.queued, false);
  assert.equal(blocked.reason, "LIMIT");
  assert.equal(q.getPendingCount(), 100);
  assert.equal(q.canEnqueue().allowed, false);
});

test("replacing a task's pending update still works when the queue is full", () => {
  fresh();
  for (let i = 0; i < 99; i++) expense();
  assert.equal(q.queueTaskUpdate(task("t1")).queued, true); // 100
  assert.equal(q.canEnqueue().allowed, false);
  assert.equal(q.canEnqueue({ replacingTaskId: "t1" }).allowed, true);
  const again = q.queueTaskUpdate(task("t1"));
  assert.equal(again.queued, true);
  assert.equal(q.getPendingCount(), 100);
});

// ---- one pending update per task -------------------------------------------------------------

test("a newer update for the same task replaces the older one and returns the old photo path", () => {
  fresh();
  const first = task("t1", { photoPath: "/docs/first.jpg", note: "first" });
  assert.deepEqual(q.queueTaskUpdate(first), { queued: true, replacedPhotoPath: null });
  const second = task("t1", { photoPath: "/docs/second.jpg", note: "second" });
  assert.deepEqual(q.queueTaskUpdate(second), { queued: true, replacedPhotoPath: "/docs/first.jpg" });

  assert.equal(q.getPendingTaskUpdateCount(), 1);
  const [row] = q.getPendingTaskUpdates();
  assert.equal(row.update_id, second.updateId);
  assert.equal(row.photo_path, "/docs/second.jpg");
  assert.equal(row.note, "second");
  assert.equal(row.sync_status, "PENDING");
  assert.equal(row.server_photo_url, null);
});

test("different tasks queue side by side; the pending lookup is per task", () => {
  fresh();
  q.queueTaskUpdate(task("t1"));
  q.queueTaskUpdate(task("t2"));
  assert.equal(q.getPendingTaskUpdateCount(), 2);
  assert.equal(q.getPendingTaskUpdateForTask("t1").task_id, "t1");
  assert.equal(q.getPendingTaskUpdateForTask("nope"), null);
});

// ---- 72 hours -----------------------------------------------------------------------------------------

test("an old pending entry blocks NEW entries (STALE) but is never deleted and still syncs", () => {
  fresh();
  q.queueTaskUpdate(task("t1"));
  expense();
  backdate("offline_task_updates", "created_at", 80);
  backdate("offline_expenses", "created_at", 80);

  q.purgeExpired(); // also runs on startup
  assert.equal(q.getPendingCount(), 2); // nothing was thrown away
  assert.equal(q.getPendingTaskUpdates().length, 1); // and it is still offered to the sync

  assert.equal(q.canEnqueue().reason, "STALE");
  assert.equal(q.queueTaskUpdate(task("t2")).reason, "STALE");
  assert.equal(expense(), false);
});

test("once the old entries have synced, queueing works again", () => {
  fresh();
  const old = task("t1");
  q.queueTaskUpdate(old);
  backdate("offline_task_updates", "created_at", 80);
  assert.equal(q.canEnqueue().allowed, false);
  q.markTaskUpdateSynced(old.updateId);
  assert.equal(q.canEnqueue().allowed, true);
});

test("old rejected rows are tidied away after 72h; old pending rows are not", () => {
  fresh();
  const rejected = task("t1");
  q.queueTaskUpdate(rejected);
  q.markTaskUpdateRejected(rejected.updateId, "TASK_CLOSED", "closed");
  q.queueTaskUpdate(task("t2"));
  backdate("offline_task_updates", "created_at", 80);
  q.purgeExpired();
  assert.equal(q.getRejectedTaskUpdates().length, 0);
  assert.equal(q.getPendingTaskUpdateCount(), 1);
});

// ---- life cycle ----------------------------------------------------------------------------------------------

test("photo URL is remembered, synced rows are purged and their file paths returned", () => {
  fresh();
  const a = task("t1", { photoPath: "/docs/a.jpg" });
  q.queueTaskUpdate(a);
  q.setTaskUpdatePhotoUrl(a.updateId, "https://r2/tasks/t1/a.jpg");
  assert.equal(q.getPendingTaskUpdateForTask("t1").server_photo_url, "https://r2/tasks/t1/a.jpg");
  q.markTaskUpdateSynced(a.updateId);
  assert.equal(q.getPendingCount(), 0);
  assert.deepEqual(q.purgeSyncedTaskUpdates(), ["/docs/a.jpg"]);
  assert.deepEqual(q.purgeSyncedTaskUpdates(), []);
});

test("rejected: kept with code and message, not counted as pending, dismissed returns the photo path", () => {
  fresh();
  const a = task("t1", { photoPath: "/docs/a.jpg" });
  q.queueTaskUpdate(a);
  q.markTaskUpdateRejected(a.updateId, "TASK_NOT_YOURS", "reassigned");
  assert.equal(q.getPendingCount(), 0);
  const [row] = q.getRejectedTaskUpdates();
  assert.equal(row.error_code, "TASK_NOT_YOURS");
  assert.equal(row.error_message, "reassigned");
  assert.equal(q.dismissRejectedTaskUpdate(a.updateId), "/docs/a.jpg");
  assert.equal(q.getRejectedTaskUpdates().length, 0);
  assert.equal(q.dismissRejectedTaskUpdate(a.updateId), null);
});

test("a replaced-then-rejected task can be queued again (rejected rows never block)", () => {
  fresh();
  const a = task("t1");
  q.queueTaskUpdate(a);
  q.markTaskUpdateRejected(a.updateId, "SUPERSEDED", "x");
  assert.equal(q.queueTaskUpdate(task("t1")).queued, true);
  assert.equal(q.getPendingTaskUpdateCount(), 1);
  assert.equal(q.getRejectedTaskUpdates().length, 1);
});

test("two people on one phone: pending updates are filtered by user", () => {
  fresh();
  q.queueTaskUpdate(task("t1", { userId: "sm-1" }));
  q.queueTaskUpdate(task("t2", { userId: "sm-2" }));
  assert.equal(q.getPendingTaskUpdates().length, 2);
  assert.deepEqual(q.getPendingTaskUpdates("sm-2").map((r) => r.task_id), ["t2"]);
});

test("pending rows survive the app restarting (initDb again on the same file)", () => {
  fresh();
  q.queueTaskUpdate(task("t1"));
  expense();
  q.initDb(); // reopen: CREATE TABLE IF NOT EXISTS must not wipe anything
  assert.equal(q.getPendingCount(), 2);
});

test("old expense behavior is unchanged: pending list is oldest first, synced rows purge", () => {
  fresh();
  const id = uid();
  q.queueExpense(id, { vendorName: "V", amount: 5 });
  assert.equal(q.getPendingExpenses().length, 1);
  assert.deepEqual(JSON.parse(q.getPendingExpenses()[0].payload), { vendorName: "V", amount: 5 });
  q.markSynced(id);
  q.purgeSynced();
  assert.equal(q.getPendingCount(), 0);
});
