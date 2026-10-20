// F10 task photo upload + existence check (POST /api/tasks/:id/photo,
// taskPhotoExists, r2 helpers). The route runs for real; the database, auth and
// R2 are fakes.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const TASK = "11111111-1111-4111-8111-111111111111";
const state = {
  me: { id: "sm-1", role: "Site Manager" },
  task: { taskid: TASK, assignedto: "sm-1", status: "Pending" },
  uploads: [],
  pending: false,
};

stub("../src/lib/db", {
  query: async (sql) => {
    const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
    if (text.startsWith("select * from tasks")) return state.task ? { rowCount: 1, rows: [state.task] } : { rowCount: 0, rows: [] };
    if (text.startsWith("select 1 from task_progress_log")) return { rowCount: state.pending ? 1 : 0, rows: [] };
    throw new Error("unexpected query: " + text);
  },
  withTransaction: async () => { throw new Error("the photo route must not write to the database"); },
});
stub("../src/middleware/auth", { requireAuth: (req, _res, next) => ((req.user = state.me), next()) });
const realR2 = require("../src/lib/r2");
stub("../src/lib/r2", {
  ...realR2,
  uploadBuffer: async (buffer, opts) => {
    state.uploads.push(opts);
    return `https://pub.example.com/${opts.keyPrefix}/abc.jpg`;
  },
});
const tasksRouter = require("../src/routes/tasks");
const { taskPhotoExists } = require("../src/lib/taskProgress");

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

async function upload(taskId, { type = "image/jpeg", bytes = JPEG, withFile = true } = {}) {
  const app = express();
  app.use("/api/tasks", tasksRouter);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, details: err.details }));
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, () => resolve(s));
  });
  try {
    const form = new FormData();
    if (withFile) form.append("photo", new Blob([bytes], { type }), "p.jpg");
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/tasks/${taskId}/photo`, { method: "POST", body: form });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

function reset() {
  state.me = { id: "sm-1", role: "Site Manager" };
  state.task = { taskid: TASK, assignedto: "sm-1", status: "Pending" };
  state.uploads.length = 0;
  state.pending = false;
}

test("assigned Site Manager: 201 with the stored URL under tasks/<id>/", async () => {
  reset();
  const res = await upload(TASK);
  assert.equal(res.status, 201);
  assert.equal(res.body.photoUrl, `https://pub.example.com/tasks/${TASK}/abc.jpg`);
  assert.deepEqual(state.uploads, [{ contentType: "image/jpeg", keyPrefix: `tasks/${TASK}` }]);
});

test("other roles get 403 and nothing is stored", async () => {
  for (const role of ["Project Manager", "Purchaser", "General Manager"]) {
    reset();
    state.me = { id: "x", role };
    assert.equal((await upload(TASK)).status, 403, role);
  }
  assert.equal(state.uploads.length, 0);
});

test("bad photos give 400: missing, wrong type, content not an image", async () => {
  reset();
  assert.equal((await upload(TASK, { withFile: false })).status, 400);
  assert.equal((await upload(TASK, { type: "text/plain" })).status, 400);
  assert.equal((await upload(TASK, { bytes: Buffer.from("just text") })).status, 400);
  assert.equal(state.uploads.length, 0);
});

test("unknown task 404; someone else's task 403; completed task 409 - nothing stored", async () => {
  reset();
  state.task = null;
  assert.equal((await upload(TASK)).status, 404);
  state.task = { taskid: TASK, assignedto: "sm-2", status: "Pending" };
  assert.equal((await upload(TASK)).status, 403);
  state.task = { taskid: TASK, assignedto: "sm-1", status: "Completed" };
  assert.equal((await upload(TASK)).status, 409);
  assert.equal(state.uploads.length, 0);
});

// ---- taskPhotoExists / r2 helpers ----------------------------------------------

const BASE = "https://pub.example.com";

test("keyFromPublicUrl is the inverse of uploadBuffer's URL, and rejects foreign or sneaky URLs", () => {
  const { keyFromPublicUrl } = realR2;
  assert.equal(keyFromPublicUrl(`${BASE}/tasks/t1/a.jpg`, BASE), "tasks/t1/a.jpg");
  assert.equal(keyFromPublicUrl(`${BASE}/tasks/t1/a.jpg`, `${BASE}/`), "tasks/t1/a.jpg"); // trailing slash on base
  assert.equal(keyFromPublicUrl("https://evil.example.com/tasks/t1/a.jpg", BASE), null);
  assert.equal(keyFromPublicUrl(`${BASE}/tasks/../secret.jpg`, BASE), null);
  assert.equal(keyFromPublicUrl(`${BASE}/tasks/t1/a.jpg?x=1`, BASE), null);
  assert.equal(keyFromPublicUrl(`${BASE}/`, BASE), null);
  assert.equal(keyFromPublicUrl(undefined, BASE), null);
  assert.equal(keyFromPublicUrl(`${BASE}/tasks/t1/a.jpg`, undefined), null);
});

test("objectExists: true when found, false on NotFound/404, THROWS on anything else", async () => {
  const { objectExists } = realR2;
  assert.equal(await objectExists("k", async () => ({})), true);
  assert.equal(await objectExists("k", async () => { throw Object.assign(new Error("x"), { name: "NotFound" }); }), false);
  assert.equal(await objectExists("k", async () => { throw Object.assign(new Error("x"), { $metadata: { httpStatusCode: 404 } }); }), false);
  await assert.rejects(() => objectExists("k", async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); }), /timed out/);
  await assert.rejects(() => objectExists("k", async () => { throw Object.assign(new Error("denied"), { $metadata: { httpStatusCode: 403 } }); }), /denied/);
});

test("taskPhotoExists: true for this task's stored photo, false for another task's or a foreign URL", async () => {
  const deps = {
    keyFromPublicUrl: (url) => realR2.keyFromPublicUrl(url, BASE),
    objectExists: async () => true,
  };
  assert.equal(await taskPhotoExists(`${BASE}/tasks/t1/a.jpg`, "t1", deps), true);
  assert.equal(await taskPhotoExists(`${BASE}/tasks/t2/a.jpg`, "t1", deps), false); // another task's photo
  assert.equal(await taskPhotoExists("https://evil.example.com/tasks/t1/a.jpg", "t1", deps), false);
  assert.equal(await taskPhotoExists(`${BASE}/receipts/t1/a.jpg`, "t1", deps), false);
});

test("taskPhotoExists: confirmed missing is false; a storage failure is thrown, not turned into false", async () => {
  const keyFromPublicUrl = (url) => realR2.keyFromPublicUrl(url, BASE);
  assert.equal(await taskPhotoExists(`${BASE}/tasks/t1/a.jpg`, "t1", { keyFromPublicUrl, objectExists: async () => false }), false);
  await assert.rejects(
    () => taskPhotoExists(`${BASE}/tasks/t1/a.jpg`, "t1", { keyFromPublicUrl, objectExists: async () => { throw new Error("timeout"); } }),
    /timeout/
  );
});

test("taskPhotoExists does not call storage when the URL is not this task's", async () => {
  let calls = 0;
  const deps = { keyFromPublicUrl: (url) => realR2.keyFromPublicUrl(url, BASE), objectExists: async () => (calls++, true) };
  await taskPhotoExists(`${BASE}/tasks/other/a.jpg`, "t1", deps);
  assert.equal(calls, 0);
});

test("a submission already waiting for review: 409 AWAITING_REVIEW and no photo is stored", async () => {
  reset();
  state.pending = true;
  const res = await upload(TASK);
  assert.equal(res.status, 409);
  assert.equal(res.body.details.code, "AWAITING_REVIEW");
  assert.match(res.body.error, /waiting for your Project Manager's review/);
  assert.equal(state.uploads.length, 0);
});
