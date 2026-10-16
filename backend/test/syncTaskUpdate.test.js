// F10 item 10.4: task submissions through POST /api/sync (syncTaskUpdate in
// routes/sync.js, built on lib/taskProgress.js). The route runs for real; the
// database, auth, storage and screening are in-memory fakes.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const BASE = "https://pub.example.com";
const SM = "sm-1";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const U1 = "aaaaaaaa-0000-4000-8000-000000000001";
const U2 = "aaaaaaaa-0000-4000-8000-000000000002";
const U3 = "aaaaaaaa-0000-4000-8000-000000000003";
const EXPENSE_UUID = "bbbbbbbb-0000-4000-8000-000000000001";
const photo = (taskId = T1, name = "a.jpg") => `${BASE}/tasks/${taskId}/${name}`;

const state = {};
function reset() {
  Object.assign(state, {
    me: { id: SM, role: "Site Manager" },
    tasks: new Map([
      [T1, { taskid: T1, assignedto: SM, status: "Pending", milestoneid: "m1" }],
      [T2, { taskid: T2, assignedto: SM, status: "Pending", milestoneid: "m1" }],
    ]),
    projectStatus: "Active",
    logs: [],
    expenses: 0,
    synced: new Set(),
    photoCheck: async () => true, // storage: object exists
    storageCalls: 0,
  });
}

async function run(sql, params = []) {
  const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
  if (text.startsWith("select action_uuid")) return { rowCount: state.synced.has(params[0]) ? 1 : 0, rows: [] };
  if (text.startsWith("select * from tasks")) {
    const t = state.tasks.get(params[0]);
    return t ? { rowCount: 1, rows: [t] } : { rowCount: 0, rows: [] };
  }
  if (text.startsWith("select * from task_progress_log where clientsubmissionid")) {
    const l = state.logs.find((x) => x.clientsubmissionid === params[0]);
    return l ? { rowCount: 1, rows: [l] } : { rowCount: 0, rows: [] };
  }
  if (text.startsWith("select p.status")) return { rowCount: 1, rows: [{ status: state.projectStatus }] };
  if (text.startsWith("select taskid from tasks") && text.includes("for update")) return { rowCount: 1, rows: [] };
  if (text.startsWith("select 1 from task_progress_log")) {
    const n = state.logs.filter((l) => l.taskid === params[0] && l.reviewstatus === "Pending Review").length;
    return { rowCount: n, rows: [] };
  }
  if (text.startsWith("update task_progress_log")) {
    state.logs.forEach((l) => l.taskid === params[0] && l.reviewstatus === "Pending Review" && (l.reviewstatus = "Superseded"));
    return { rowCount: 0, rows: [] };
  }
  if (text.startsWith("insert into task_progress_log")) {
    const [taskid, submittedby, clientsubmissionid, photoevidenceurl, note] = params;
    const row = { taskid, submittedby, clientsubmissionid, photoevidenceurl, note, reviewstatus: "Pending Review" };
    state.logs.push(row);
    return { rowCount: 1, rows: [row] };
  }
  // expenses (only used for the per-item isolation test)
  if (text.startsWith("select status from projects")) return { rowCount: 1, rows: [{ status: "Active" }] };
  if (text.startsWith("insert into expenses")) return (state.expenses++, { rowCount: 1, rows: [{ expenseid: "e-1" }] });
  if (text.startsWith("insert into synced_actions")) return (state.synced.add(params[0]), { rowCount: 1, rows: [] });
  throw new Error("unexpected query: " + text);
}

stub("../src/lib/db", { query: run, withTransaction: async (fn) => fn({ query: run }) });
stub("../src/middleware/auth", { requireAuth: (req, _res, next) => ((req.user = state.me), next()) });
stub("../src/lib/receiptStorage", { receiptImageExists: async () => true });
stub("../src/lib/screenExpense", { screenExpense: async () => ({ flagTypes: [] }) });
const realR2 = require("../src/lib/r2");
stub("../src/lib/r2", {
  ...realR2,
  keyFromPublicUrl: (url) => realR2.keyFromPublicUrl(url, BASE),
  objectExists: async (key) => (state.storageCalls++, state.photoCheck(key)),
});
const syncRouter = require("../src/routes/sync");

async function sync(items) {
  const app = express();
  app.use(express.json());
  app.use("/api/sync", syncRouter);
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

const item = (uuid, data, type = "task_update") => ({ uuid, type, data });
const good = (uuid = U1, extra = {}) => item(uuid, { taskId: T1, photoUrl: photo(), note: "done", ...extra });
const codeOf = (res, id) => res.body.rejected.find((r) => r.id === id)?.code;

// ---- the happy path ----------------------------------------------------------------

test("a valid update is synced and creates exactly one Pending Review row", async () => {
  reset();
  const res = await sync([good()]);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { syncedIds: [U1], rejected: [] });
  assert.equal(state.logs.length, 1);
  assert.equal(state.logs[0].reviewstatus, "Pending Review");
  assert.equal(state.logs[0].photoevidenceurl, photo());
  assert.equal(state.logs[0].note, "done");
  assert.equal(state.logs[0].submittedby, SM);
  assert.equal(state.tasks.get(T1).status, "Pending"); // only the PM Acknowledge completes a task
});

test("the same uuid sent twice creates one row; the second call still reports synced", async () => {
  reset();
  await sync([good()]);
  const again = await sync([good()]);
  assert.deepEqual(again.body, { syncedIds: [U1], rejected: [] });
  assert.equal(state.logs.length, 1);
});

test("replaying an item whose task was since Completed still reports synced (not TASK_CLOSED)", async () => {
  reset();
  await sync([good()]);
  state.tasks.get(T1).status = "Completed";
  const again = await sync([good()]);
  assert.deepEqual(again.body.syncedIds, [U1]);
  assert.equal(again.body.rejected.length, 0);
});

// ---- one test per reject code ------------------------------------------------------------

test("TASK_NOT_FOUND: unknown task, and a taskId that is not an id", async () => {
  reset();
  const res = await sync([
    item(U1, { taskId: "99999999-9999-4999-8999-999999999999", photoUrl: photo() }),
    item(U2, { taskId: "nope", photoUrl: photo() }),
  ]);
  assert.equal(codeOf(res, U1), "TASK_NOT_FOUND");
  assert.equal(codeOf(res, U2), "TASK_NOT_FOUND");
  assert.equal(state.logs.length, 0);
});

test("TASK_NOT_YOURS: the task was reassigned while the update was queued", async () => {
  reset();
  state.tasks.get(T1).assignedto = "sm-2";
  assert.equal(codeOf(await sync([good()]), U1), "TASK_NOT_YOURS");
  assert.equal(state.logs.length, 0);
});

test("TASK_CLOSED: the task is already Completed", async () => {
  reset();
  state.tasks.get(T1).status = "Completed";
  assert.equal(codeOf(await sync([good()]), U1), "TASK_CLOSED");
  assert.equal(state.logs.length, 0);
});

test("PROJECT_NOT_ACTIVE: the project is no longer Active", async () => {
  reset();
  for (const status of ["Completed", "Cancelled", "Draft", "Archived"]) {
    state.projectStatus = status;
    assert.equal(codeOf(await sync([good()]), U1), "PROJECT_NOT_ACTIVE", status);
  }
  assert.equal(state.logs.length, 0);
});

test("MISSING_PHOTO: no photoUrl, a confirmed-missing file, another task's photo, or an outside link", async () => {
  reset();
  let res = await sync([item(U1, { taskId: T1 })]);
  assert.equal(codeOf(res, U1), "MISSING_PHOTO");

  state.photoCheck = async () => false; // storage says: no such object
  res = await sync([good(U2)]);
  assert.equal(codeOf(res, U2), "MISSING_PHOTO");

  state.photoCheck = async () => true;
  res = await sync([good(U3, { photoUrl: photo(T2) })]); // a photo stored for ANOTHER task
  assert.equal(codeOf(res, U3), "MISSING_PHOTO");
  res = await sync([good(U3, { photoUrl: "https://evil.example.com/tasks/" + T1 + "/a.jpg" })]);
  assert.equal(codeOf(res, U3), "MISSING_PHOTO");
  assert.equal(state.logs.length, 0);
});

test("SUPERSEDED: the task already has a submission waiting for review (server wins)", async () => {
  reset();
  await sync([good(U1)]); // an earlier submission, now Pending Review
  const res = await sync([good(U2, { photoUrl: photo(T1, "b.jpg") })]);
  assert.equal(codeOf(res, U2), "SUPERSEDED");
  assert.equal(state.logs.length, 1);
  assert.equal(state.logs[0].reviewstatus, "Pending Review"); // the earlier one is untouched
  assert.equal(state.logs[0].clientsubmissionid, U1);
});

test("DUPLICATE_UUID: the uuid already belongs to someone else's submission", async () => {
  reset();
  state.logs.push({ taskid: T2, submittedby: "sm-2", clientsubmissionid: U1, reviewstatus: "Acknowledged" });
  assert.equal(codeOf(await sync([good(U1)]), U1), "DUPLICATE_UUID");
});

test("INVALID_FIELDS: uuid not a UUID, or note not text", async () => {
  reset();
  const res = await sync([good("not-a-uuid"), good(U1, { note: 42 })]);
  assert.equal(codeOf(res, "not-a-uuid"), "INVALID_FIELDS");
  assert.equal(codeOf(res, U1), "INVALID_FIELDS");
});

test("a storage failure is NOT a rejection: the item is left out so the phone retries, then it syncs", async () => {
  reset();
  state.photoCheck = async () => { throw new Error("timeout"); };
  const first = await sync([good()]);
  assert.deepEqual(first.body, { syncedIds: [], rejected: [] }); // phone keeps it PENDING
  assert.equal(state.logs.length, 0);

  state.photoCheck = async () => true; // storage is back
  const second = await sync([good()]);
  assert.deepEqual(second.body, { syncedIds: [U1], rejected: [] });
  assert.equal(state.logs.length, 1);
});

test("a replay never touches storage (no photo check for an already-saved item)", async () => {
  reset();
  await sync([good()]);
  const before = state.storageCalls;
  state.photoCheck = async () => { throw new Error("storage is down"); };
  const again = await sync([good()]);
  assert.deepEqual(again.body.syncedIds, [U1]);
  assert.equal(state.storageCalls, before);
});

// ---- roles and isolation ---------------------------------------------------------------------

const expense = () =>
  item(
    EXPENSE_UUID,
    {
      projectID: "44444444-4444-4444-8444-444444444444",
      vendorName: "Cebu Builders",
      amount: 1500,
      receiptDate: "2026-10-10",
      category: "Materials",
      receiptImageURL: "http://x/receipts/files/a.jpg",
      lineItems: [{ description: "Cement", quantity: 3, amount: 1500 }],
    },
    "expense"
  );

test("a Purchaser sending a task_update gets WRONG_ROLE for that item; a valid expense in the same batch still syncs", async () => {
  reset();
  state.me = { id: "purchaser-1", role: "Purchaser" };
  const res = await sync([good(U1), expense()]);
  assert.equal(res.status, 200);
  assert.equal(codeOf(res, U1), "WRONG_ROLE");
  assert.deepEqual(res.body.syncedIds, [EXPENSE_UUID]);
  assert.equal(state.expenses, 1);
  assert.equal(state.logs.length, 0);
});

test("a Site Manager sending an expense gets WRONG_ROLE; their task_update in the same batch still syncs", async () => {
  reset();
  const res = await sync([expense(), good(U1)]);
  assert.equal(codeOf(res, EXPENSE_UUID), "WRONG_ROLE");
  assert.deepEqual(res.body.syncedIds, [U1]);
  assert.equal(state.expenses, 0);
});

test("Project Manager and General Manager: every item is WRONG_ROLE (200, not a whole-request 403)", async () => {
  for (const role of ["Project Manager", "General Manager"]) {
    reset();
    state.me = { id: "x", role };
    const res = await sync([good(U1), expense()]);
    assert.equal(res.status, 200, role);
    assert.deepEqual(res.body.rejected.map((r) => r.code), ["WRONG_ROLE", "WRONG_ROLE"], role);
  }
});

test("one bad item never blocks the good ones; response keeps the { syncedIds, rejected } shape", async () => {
  reset();
  const res = await sync([good(U1, { photoUrl: "" }), item(U2, { taskId: T2, photoUrl: photo(T2) })]);
  assert.deepEqual(Object.keys(res.body).sort(), ["rejected", "syncedIds"]);
  assert.equal(codeOf(res, U1), "MISSING_PHOTO");
  assert.deepEqual(res.body.syncedIds, [U2]);
});

test("a missing uuid and an unknown type are rejected per item", async () => {
  reset();
  const res = await sync([{ type: "task_update", data: {} }, item(U1, {}, "ticket_comment")]);
  assert.equal(res.body.rejected[0].code, "MISSING_UUID");
  assert.equal(codeOf(res, U1), "UNSUPPORTED_TYPE");
});

test("an empty batch is still a 400", async () => {
  reset();
  assert.equal((await sync([])).status, 400);
});
