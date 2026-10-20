// F10 mobile sync loop (lib/sync/sync.js + task-photo.js): photo first, one
// batch, mark synced / rejected / keep pending. The real code runs; the network,
// the file system and the session are stand-ins.
// Run from mobile/:  npm test
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
const shim = await import("./expo-sqlite-shim.mjs");
const { fs } = await import("./file-system-shim.mjs");
const { setSession } = await import("./auth-shim.mjs");
const q = await import("../db.js");
const { syncAllPending } = await import("../sync.js");

const SM = { token: "t", user: { id: "sm-1", role: "Site Manager" } };
const PURCHASER = { token: "t", user: { id: "p-1", role: "Purchaser" } };
let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const calls = { fetches: [], order: [] };
let serverReply; // (items) => { status?, body } | throws
function fakeFetch() {
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.fetches.push({ url, init, body });
    calls.order.push("batch");
    const reply = await serverReply(body.items);
    return { ok: (reply.status ?? 200) < 300, status: reply.status ?? 200, json: async () => reply.body };
  };
}
const syncAll = (items) => ({ body: { syncedIds: items.map((i) => i.uuid), rejected: [] } });

function setup(session = SM) {
  shim.resetShim();
  q.initDb();
  fs.reset();
  calls.fetches.length = 0;
  calls.order.length = 0;
  serverReply = async (items) => syncAll(items);
  fakeFetch();
  setSession(session);
  const origUpload = fs.uploadHandler;
  fs.uploadHandler = async (...args) => (calls.order.push("upload"), origUpload(...args));
}

// Queue a task update whose photo file "exists" on the phone.
function queueTask(taskId, { userId = "sm-1", note = "done" } = {}) {
  const updateId = uid();
  const photoPath = `/docs/${taskId}.jpg`;
  fs.existing.add(photoPath);
  assert.equal(q.queueTaskUpdate({ updateId, taskId, userId, photoPath, note }).queued, true);
  return { updateId, photoPath };
}

test("photo is uploaded FIRST, then one batch carries only the URL; synced row is purged and its file deleted", async () => {
  setup();
  const { updateId, photoPath } = queueTask("t1");
  fs.uploadHandler = async (...a) => (calls.order.push("upload"), { status: 201, body: JSON.stringify({ photoUrl: "https://r2/tasks/t1/a.jpg" }) });

  const result = await syncAllPending();
  assert.deepEqual(calls.order, ["upload", "batch"]);
  assert.equal(fs.uploads.length, 1);
  assert.equal(fs.uploads[0].url, "http://api.test/api/tasks/t1/photo");
  assert.equal(fs.uploads[0].options.fieldName, "photo");
  assert.equal(fs.uploads[0].options.mimeType, "image/jpeg");
  assert.deepEqual(fs.uploads[0].options.headers, { Authorization: "Bearer test-token" });

  assert.equal(calls.fetches.length, 1);
  assert.equal(calls.fetches[0].url, "http://api.test/api/sync");
  assert.equal(calls.fetches[0].init.headers.Authorization, "Bearer test-token");
  assert.deepEqual(calls.fetches[0].body.items, [
    { uuid: updateId, type: "task_update", data: { taskId: "t1", photoUrl: "https://r2/tasks/t1/a.jpg", note: "done" } },
  ]);

  assert.equal(result.synced, 1);
  assert.equal(result.tasks.synced, 1);
  assert.equal(q.getPendingCount(), 0);
  assert.deepEqual(fs.deleted, [photoPath]);
});

test("a .png photo is uploaded as image/png; an empty note is left out of the batch", async () => {
  setup();
  fs.existing.add("/docs/x.png");
  q.queueTaskUpdate({ updateId: uid(), taskId: "t1", userId: "sm-1", photoPath: "/docs/x.png", note: "" });
  await syncAllPending();
  assert.equal(fs.uploads[0].options.mimeType, "image/png");
  assert.equal("note" in calls.fetches[0].body.items[0].data, false);
});

test("batch fails after the photo uploaded: row stays pending, and the retry does NOT upload again", async () => {
  setup();
  const { updateId } = queueTask("t1");
  serverReply = async () => { throw new Error("Network request failed"); };
  await assert.rejects(() => syncAllPending(), /Network request failed/);
  assert.equal(fs.uploads.length, 1);
  assert.equal(q.getPendingTaskUpdateForTask("t1").server_photo_url, "https://r2/tasks/x/p.jpg"); // remembered

  serverReply = async (items) => syncAll(items);
  const result = await syncAllPending();
  assert.equal(fs.uploads.length, 1); // still one upload in total
  assert.equal(calls.fetches.at(-1).body.items[0].data.photoUrl, "https://r2/tasks/x/p.jpg");
  assert.equal(result.tasks.synced, 1);
  assert.equal(q.getPendingCount(), 0);
  assert.ok(updateId);
});

test("a server error status on the batch throws and keeps everything pending", async () => {
  setup();
  queueTask("t1");
  serverReply = async () => ({ status: 503, body: {} });
  await assert.rejects(() => syncAllPending(), /Sync failed: 503/);
  assert.equal(q.getPendingCount(), 1);
});

test("rejected items are kept with their code and message, photo file kept; synced ones go", async () => {
  setup();
  const a = queueTask("t1");
  const b = queueTask("t2");
  serverReply = async () => ({
    body: {
      syncedIds: [a.updateId],
      rejected: [{ id: b.updateId, code: "TASK_NOT_YOURS", message: "reassigned" }],
    },
  });
  const result = await syncAllPending();
  assert.deepEqual([result.tasks.synced, result.tasks.rejected], [1, 1]);
  const [row] = q.getRejectedTaskUpdates();
  assert.equal(row.update_id, b.updateId);
  assert.equal(row.error_code, "TASK_NOT_YOURS");
  assert.equal(row.error_message, "reassigned");
  assert.deepEqual(fs.deleted, [a.photoPath]); // only the synced one's file is deleted
  assert.equal(q.getPendingCount(), 0);
});

test("an item the server left out of both lists (could not check) stays pending", async () => {
  setup();
  const a = queueTask("t1");
  serverReply = async () => ({ body: { syncedIds: [], rejected: [] } });
  const result = await syncAllPending();
  assert.equal(result.synced + result.rejected, 0);
  assert.equal(q.getPendingTaskUpdateForTask("t1").update_id, a.updateId);
  assert.deepEqual(fs.deleted, []);
});

// ---- photo upload outcomes ----------------------------------------------------------------

test("photo refused for good (403/404/409/400): rejected without a batch call; error code is the plain one", async () => {
  const cases = [[403, "TASK_NOT_YOURS"], [404, "TASK_NOT_FOUND"], [409, "TASK_CLOSED"], [400, "MISSING_PHOTO"]];
  for (const [status, code] of cases) {
    setup();
    queueTask("t1");
    fs.uploadHandler = async () => ({ status, body: JSON.stringify({ error: "nope" }) });
    const result = await syncAllPending();
    assert.equal(result.tasks.rejected, 1, String(status));
    assert.equal(q.getRejectedTaskUpdates()[0].error_code, code);
    assert.equal(calls.fetches.length, 0); // nothing left to send
  }
});

test("the photo file is gone from the phone: rejected MISSING_PHOTO, no upload attempted", async () => {
  setup();
  const { photoPath } = queueTask("t1");
  fs.existing.delete(photoPath);
  const result = await syncAllPending();
  assert.equal(fs.uploads.length, 0);
  assert.equal(result.tasks.rejected, 1);
  assert.equal(q.getRejectedTaskUpdates()[0].error_code, "MISSING_PHOTO");
});

test("temporary upload failures (5xx, 401, no network) keep the entry pending and do not block other items", async () => {
  for (const handler of [
    async () => ({ status: 500, body: "{}" }),
    async () => ({ status: 401, body: "{}" }),
    async () => { throw new Error("Network request failed"); },
  ]) {
    setup();
    queueTask("t1");
    const second = queueTask("t2");
    let first = true;
    fs.uploadHandler = async (...a) => (first ? ((first = false), handler()) : { status: 201, body: JSON.stringify({ photoUrl: "https://r2/tasks/t2/b.jpg" }) });
    const result = await syncAllPending();
    assert.equal(result.tasks.synced, 1);
    assert.deepEqual(calls.fetches[0].body.items.map((i) => i.uuid), [second.updateId]);
    assert.equal(q.getPendingTaskUpdateForTask("t1").server_photo_url, null); // will try again
    assert.equal(q.getRejectedTaskUpdates().length, 0);
  }
});

// ---- who sends what ---------------------------------------------------------------------------------

test("Purchaser and Site Manager items go in ONE batch only when both are allowed; each role sends its own kind", async () => {
  setup(PURCHASER);
  const expenseId = uid();
  q.queueExpense(expenseId, { vendorName: "V", amount: 5 });
  queueTask("t1");
  const asPurchaser = await syncAllPending();
  assert.deepEqual(calls.fetches[0].body.items.map((i) => i.type), ["expense"]);
  assert.equal(asPurchaser.expenses.synced, 1);
  assert.equal(q.getPendingTaskUpdateCount(), 1); // the Site Manager's entry is untouched

  setSession(SM);
  const asSm = await syncAllPending();
  assert.deepEqual(calls.fetches[1].body.items.map((i) => i.type), ["task_update"]);
  assert.equal(asSm.tasks.synced, 1);
});

test("a task update queued by another user on this phone is not sent", async () => {
  setup();
  queueTask("t1", { userId: "someone-else" });
  const result = await syncAllPending();
  assert.equal(calls.fetches.length, 0);
  assert.equal(result.synced, 0);
  assert.equal(q.getPendingTaskUpdateCount(), 1);
});

test("signed out: nothing is sent and nothing is lost", async () => {
  setup(null);
  queueTask("t1");
  const result = await syncAllPending();
  assert.equal(calls.fetches.length, 0);
  assert.equal(fs.uploads.length, 0);
  assert.equal(result.synced, 0);
  assert.equal(q.getPendingTaskUpdateCount(), 1);
});

test("nothing pending: no network call at all", async () => {
  setup();
  const result = await syncAllPending();
  assert.equal(calls.fetches.length, 0);
  assert.deepEqual(result, { synced: 0, rejected: 0, expenses: { synced: 0, rejected: 0 }, tasks: { synced: 0, rejected: 0 }, rejectedItems: [], postponedItems: [] });
});

test("expenses still sync exactly as before (response shape unchanged)", async () => {
  setup(PURCHASER);
  const a = uid();
  const b = uid();
  q.queueExpense(a, { vendorName: "A", amount: 1 });
  q.queueExpense(b, { vendorName: "B", amount: 2 });
  serverReply = async () => ({ body: { syncedIds: [a], rejected: [{ id: b, code: "INVALID_AMOUNT", message: "bad" }] } });
  const result = await syncAllPending();
  assert.deepEqual([result.synced, result.rejected], [1, 1]);
  assert.equal(q.getRejectedExpenses()[0].reject_code, "INVALID_AMOUNT");
  assert.equal(q.getPendingCount(), 0);
});

test("role rule on its own: a Purchaser never sends task updates, even ones stored under their own id", async () => {
  setup(PURCHASER);
  queueTask("t1", { userId: "p-1" }); // same id as the signed-in Purchaser
  const result = await syncAllPending();
  assert.equal(calls.fetches.length, 0);
  assert.equal(fs.uploads.length, 0);
  assert.equal(result.synced, 0);
});

test("rejectedItems lists every rejection with its kind, code and message (server and photo upload)", async () => {
  setup();
  const a = queueTask("t1");
  queueTask("t2");
  let first = true;
  fs.uploadHandler = async () => (first ? ((first = false), { status: 201, body: JSON.stringify({ photoUrl: "https://r2/tasks/t1/a.jpg" }) }) : { status: 409, body: JSON.stringify({ error: "closed" }) });
  serverReply = async () => ({ body: { syncedIds: [], rejected: [{ id: a.updateId, code: "SUPERSEDED", message: "waiting" }] } });
  const result = await syncAllPending();
  assert.deepEqual(
    result.rejectedItems.map((i) => [i.kind, i.code]).sort(),
    [["task_update", "SUPERSEDED"], ["task_update", "TASK_CLOSED"]]
  );
});

test("postponedItems: a photo that could not upload yet, and an item the server left unanswered, are reported (so the screen can say 'not sent yet')", async () => {
  setup();
  const a = queueTask("t1");
  const b = queueTask("t2");
  fs.uploadHandler = async (url) =>
    url.includes("/t1/") ? { status: 503, body: "{}" } : { status: 201, body: JSON.stringify({ photoUrl: "https://r2/tasks/t2/b.jpg" }) };
  serverReply = async () => ({ body: { syncedIds: [], rejected: [] } }); // server could not check t2 yet
  const result = await syncAllPending();
  assert.deepEqual(result.postponedItems.map((p) => p.id).sort(), [a.updateId, b.updateId].sort());
  assert.equal(result.synced + result.rejected, 0);
  assert.equal(q.getPendingTaskUpdateCount(), 2); // both still queued, will retry
});

test("a fully sent batch has no postponedItems", async () => {
  setup();
  queueTask("t1");
  const result = await syncAllPending();
  assert.deepEqual(result.postponedItems, []);
  assert.equal(result.tasks.synced, 1);
});
