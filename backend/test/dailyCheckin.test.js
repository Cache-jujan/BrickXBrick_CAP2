// Daily progress check-ins (lib/dailyCheckin.js): slot windows in Philippine
// time, input rules, replay safety, ownership, and "never touches tasks".
process.env.R2_PUBLIC_BASE_URL = "https://r2.example/";
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CheckinError,
  manilaParts,
  parseWindow,
  isOnTime,
  suggestSlot,
  slotState,
  normalizeCheckin,
  photoKeyOk,
  checkinPhotoExists,
  submitCheckin,
  reviewCheckin,
  loadCheckinDetail,
} = require("../src/lib/dailyCheckin");

const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SM = { id: ID(1) };
const PROJECT = ID(10);
const NOW = new Date("2026-10-23T06:30:00Z"); // 14:30 in Manila
const WINDOWS = {
  Morning: { start: 300, end: 600 },
  Midday: { start: 600, end: 840 },
  EndOfDay: { start: 840, end: 1260 },
};

const input = (extra = {}) => ({
  clientSubmissionId: ID(100),
  projectId: PROJECT,
  slot: "EndOfDay",
  capturedAt: "2026-10-23T06:20:00Z",
  siteStatus: "On Track",
  summary: "Slab poured",
  ...extra,
});
const rejectsWith = (fn, code) =>
  assert.throws(fn, (e) => e instanceof CheckinError && e.code === code, `expected ${code}`);

// ---- time -------------------------------------------------------------------

test("manilaParts reads the Philippine day and minutes, across midnight UTC", () => {
  assert.deepEqual(manilaParts(new Date("2026-10-23T06:30:00Z")), { date: "2026-10-23", minutes: 14 * 60 + 30 });
  assert.deepEqual(manilaParts(new Date("2026-10-22T17:00:00Z")), { date: "2026-10-23", minutes: 60 }); // 01:00 next day
  assert.deepEqual(manilaParts(new Date("2026-10-22T15:59:00Z")), { date: "2026-10-22", minutes: 23 * 60 + 59 });
});

test("parseWindow accepts HH:MM-HH:MM and rejects nonsense", () => {
  assert.deepEqual(parseWindow("05:00-10:00"), { start: 300, end: 600 });
  assert.equal(parseWindow("10:00-05:00"), null);
  assert.equal(parseWindow("10:00"), null);
  assert.equal(parseWindow("25:00-26:00"), null);
  assert.equal(parseWindow(null), null);
});

test("a time is on time only inside its slot's window", () => {
  assert.equal(isOnTime("Morning", 9 * 60 + 59, WINDOWS), true);
  assert.equal(isOnTime("Morning", 10 * 60, WINDOWS), false);
  assert.equal(isOnTime("Midday", 9 * 60, WINDOWS), false);
});

test("suggestSlot: open window, else the next one, else end of day", () => {
  assert.equal(suggestSlot(7 * 60, WINDOWS), "Morning");
  assert.equal(suggestSlot(11 * 60, WINDOWS), "Midday");
  assert.equal(suggestSlot(15 * 60, WINDOWS), "EndOfDay");
  assert.equal(suggestSlot(3 * 60, WINDOWS), "Morning");
  assert.equal(suggestSlot(23 * 60, WINDOWS), "EndOfDay");
});

test("slotState: Submitted, Open, Upcoming, Missed", () => {
  const at = (iso) => new Date(iso);
  const s = (slot, day, now, submitted = false) => slotState({ slot, day, now, windows: WINDOWS, submitted });
  const now = at("2026-10-23T06:30:00Z"); // 14:30
  assert.equal(s("Morning", "2026-10-23", now, true), "Submitted");
  assert.equal(s("Morning", "2026-10-23", now), "Missed");
  assert.equal(s("Midday", "2026-10-23", now), "Missed");
  assert.equal(s("EndOfDay", "2026-10-23", now), "Open");
  assert.equal(s("EndOfDay", "2026-10-23", at("2026-10-23T04:00:00Z")), "Upcoming"); // 12:00
  assert.equal(s("EndOfDay", "2026-10-22", now), "Missed");
  assert.equal(s("Morning", "2026-10-24", now), "Upcoming");
});

// ---- input ------------------------------------------------------------------

test("a valid check-in is normalised; the day comes from capturedAt in Manila time", () => {
  const out = normalizeCheckin(input({ capturedAt: "2026-10-22T17:30:00Z", slot: "Morning" }), NOW);
  assert.equal(out.checkinDate, "2026-10-23");
  assert.equal(out.minutes, 90);
  assert.equal(out.summary, "Slab poured");
  assert.deepEqual(out.taskIds, []);
  assert.deepEqual(out.photoUrls, []);
  assert.equal(out.needsPmAction, false);
});

test("input rules", () => {
  rejectsWith(() => normalizeCheckin(input({ clientSubmissionId: "x" }), NOW), "INVALID_FIELDS");
  rejectsWith(() => normalizeCheckin(input({ projectId: "x" }), NOW), "PROJECT_NOT_FOUND");
  rejectsWith(() => normalizeCheckin(input({ slot: "Noon" }), NOW), "INVALID_FIELDS");
  rejectsWith(() => normalizeCheckin(input({ siteStatus: "Fine" }), NOW), "INVALID_FIELDS");
  rejectsWith(() => normalizeCheckin(input({ summary: "   " }), NOW), "INVALID_FIELDS");
  rejectsWith(() => normalizeCheckin(input({ summary: "x".repeat(2001) }), NOW), "INVALID_FIELDS");
  rejectsWith(() => normalizeCheckin(input({ capturedAt: "soon" }), NOW), "INVALID_FIELDS");
  rejectsWith(() => normalizeCheckin(input({ capturedAt: "2026-10-23T08:00:00Z" }), NOW), "INVALID_FIELDS"); // 1.5h ahead
  rejectsWith(() => normalizeCheckin(input({ capturedAt: "2026-10-20T06:00:00Z" }), NOW), "TOO_OLD");
  rejectsWith(() => normalizeCheckin(input({ needsPmAction: true }), NOW), "INVALID_FIELDS");
  rejectsWith(() => normalizeCheckin(input({ needsPmAction: "yes" }), NOW), "INVALID_FIELDS");
  rejectsWith(() => normalizeCheckin(input({ taskIds: ["x"] }), NOW), "INVALID_FIELDS");
  rejectsWith(() => normalizeCheckin(input({ taskIds: Array.from({ length: 21 }, (_, i) => ID(i + 1)) }), NOW), "INVALID_FIELDS");
  rejectsWith(() => normalizeCheckin(input({ photoUrls: ["a", "b", "c", "d"] }), NOW), "INVALID_FIELDS");
  // a phone clock a few minutes ahead is tolerated
  assert.doesNotThrow(() => normalizeCheckin(input({ capturedAt: "2026-10-23T06:33:00Z" }), NOW));
  // an issue with text is fine
  assert.equal(normalizeCheckin(input({ needsPmAction: true, issues: "Cement late" }), NOW).needsPmAction, true);
});

// ---- photos -----------------------------------------------------------------

const BASE = "https://r2.example/";
const keyFromUrl = (url) => (typeof url === "string" && url.startsWith(BASE) ? url.slice(BASE.length) : null);

test("only photos stored under checkins/<projectId>/ count", async () => {
  assert.equal(photoKeyOk(`${BASE}checkins/${PROJECT}/a.jpg`, PROJECT, keyFromUrl), true);
  assert.equal(photoKeyOk(`${BASE}checkins/${ID(11)}/a.jpg`, PROJECT, keyFromUrl), false); // another project
  assert.equal(photoKeyOk(`${BASE}tasks/${PROJECT}/a.jpg`, PROJECT, keyFromUrl), false); // a task photo
  assert.equal(photoKeyOk("https://evil.example/x.jpg", PROJECT, keyFromUrl), false);

  const url = `${BASE}checkins/${PROJECT}/a.jpg`;
  assert.equal(await checkinPhotoExists(url, PROJECT, { keyFromPublicUrl: keyFromUrl, objectExists: async () => true }), true);
  assert.equal(await checkinPhotoExists(url, PROJECT, { keyFromPublicUrl: keyFromUrl, objectExists: async () => false }), false);
  await assert.rejects(
    checkinPhotoExists(url, PROJECT, { keyFromPublicUrl: keyFromUrl, objectExists: async () => { throw new Error("timeout"); } }),
    /timeout/
  ); // a storage problem is never "missing"
});

// ---- submit -----------------------------------------------------------------

// A fake database: recognises each statement by its start and records everything.
function fakeDb({ project = {}, existingById = null, slotTaken = false, tasksFound = null, conflictOnInsert = null } = {}) {
  const calls = [];
  const proj = { projectid: PROJECT, name: "Alpha", status: "Active", projectmanagerid: ID(2), sitemanagerid: SM.id, ...project };
  const respond = (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT settingKey")) return { rows: [], rowCount: 0 };
    if (sql.startsWith("SELECT * FROM daily_progress_checkins WHERE clientSubmissionId"))
      return existingById ? { rows: [existingById], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (sql.startsWith("SELECT projectId, name, status")) return { rows: [proj], rowCount: 1 };
    if (sql.startsWith("SELECT checkinId FROM daily_progress_checkins")) return slotTaken ? { rows: [{ checkinid: ID(500) }], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (sql.startsWith("SELECT t.taskId")) {
      const n = tasksFound === null ? params[0].length : tasksFound;
      return { rows: Array.from({ length: n }, () => ({})), rowCount: n };
    }
    if (sql.startsWith("INSERT INTO daily_progress_checkins")) {
      if (conflictOnInsert) throw Object.assign(new Error("dup"), { code: "23505", constraint: conflictOnInsert });
      return { rows: [{ checkinid: ID(600), onTimeArg: params[10] }], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO daily_checkin_photos") || sql.startsWith("INSERT INTO daily_checkin_tasks") || sql.startsWith("INSERT INTO notifications"))
      return { rows: [], rowCount: 1 };
    throw new Error(`Unhandled query in fake db: ${sql}`);
  };
  const query = async (text, params) => respond(text.replace(/\s+/g, " ").trim(), params);
  return { calls, query, withTransaction: async (fn) => fn({ query }), proj };
}
const sqlOf = (db) => db.calls.map((c) => c.sql).join("\n");

test("submit: saves the check-in, its tasks and photos, and marks on-time by Manila time", async () => {
  const db = fakeDb();
  const url = `${BASE}checkins/${PROJECT}/a.jpg`;
  const { checkin, replayed } = await submitCheckin(
    { user: SM, input: input({ taskIds: [ID(20)], photoUrls: [url] }), now: NOW },
    db
  );
  assert.equal(replayed, false);
  assert.equal(checkin.checkinid, ID(600));
  const insert = db.calls.find((c) => c.sql.startsWith("INSERT INTO daily_progress_checkins"));
  assert.equal(insert.params[3], "2026-10-23"); // checkinDate
  assert.equal(insert.params[10], true); // 14:20 is inside the End-of-day window (14:00-21:00)
  assert.equal(db.calls.filter((c) => c.sql.startsWith("INSERT INTO daily_checkin_tasks")).length, 1);
});

test("submit: a slot filled outside its window is accepted but not on time", async () => {
  const db = fakeDb();
  await submitCheckin({ user: SM, input: input({ slot: "Morning" }), now: NOW }, db);
  assert.equal(db.calls.find((c) => c.sql.startsWith("INSERT INTO daily_progress_checkins")).params[10], false);
});

test("submit: a replay of the same id by the same person returns the saved row and writes nothing", async () => {
  const saved = { checkinid: ID(700), submittedby: SM.id, projectid: PROJECT };
  const db = fakeDb({ existingById: saved });
  const out = await submitCheckin({ user: SM, input: input(), now: NOW }, db);
  assert.equal(out.replayed, true);
  assert.equal(out.checkin.checkinid, ID(700));
  assert.ok(!sqlOf(db).includes("INSERT"));
});

test("submit: the same id used by someone else, or on another project, is refused", async () => {
  for (const existing of [{ checkinid: ID(1), submittedby: ID(99), projectid: PROJECT }, { checkinid: ID(1), submittedby: SM.id, projectid: ID(77) }]) {
    await assert.rejects(submitCheckin({ user: SM, input: input(), now: NOW }, fakeDb({ existingById: existing })), (e) => e.code === "CLIENT_ID_IN_USE" && e.status === 409);
  }
});

test("submit: only the project's Site Manager, only while Active", async () => {
  await assert.rejects(submitCheckin({ user: { id: ID(9) }, input: input(), now: NOW }, fakeDb()), (e) => e.code === "NOT_YOUR_PROJECT" && e.status === 403);
  for (const status of ["Draft", "Completed", "Cancelled"]) {
    await assert.rejects(submitCheckin({ user: SM, input: input(), now: NOW }, fakeDb({ project: { status } })), (e) => e.code === "PROJECT_NOT_ACTIVE" && e.status === 409);
  }
});

test("submit: one check-in per slot per day, told apart from a replay", async () => {
  await assert.rejects(submitCheckin({ user: SM, input: input(), now: NOW }, fakeDb({ slotTaken: true })), (e) => e.code === "CHECKIN_EXISTS" && e.details.checkinId === ID(500));
  // the database rule catches two phones racing past the check above
  await assert.rejects(
    submitCheckin({ user: SM, input: input(), now: NOW }, fakeDb({ conflictOnInsert: "daily_checkins_one_per_slot" })),
    (e) => e.code === "CHECKIN_EXISTS"
  );
});

test("submit: linked tasks must be the Site Manager's own tasks on this project", async () => {
  await assert.rejects(submitCheckin({ user: SM, input: input({ taskIds: [ID(20), ID(21)] }), now: NOW }, fakeDb({ tasksFound: 1 })), (e) => e.code === "TASK_NOT_FOUND");
});

test("submit: photos from elsewhere are refused; sync can also require them to exist in storage", async () => {
  await assert.rejects(submitCheckin({ user: SM, input: input({ photoUrls: ["https://evil.example/x.jpg"] }), now: NOW }, fakeDb()), (e) => e.code === "MISSING_PHOTO");
  const url = `${BASE}checkins/${PROJECT}/a.jpg`;
  await assert.rejects(
    submitCheckin({ user: SM, input: input({ photoUrls: [url] }), verifyPhoto: async () => false, now: NOW }, fakeDb()),
    (e) => e.code === "MISSING_PHOTO"
  );
  const ok = await submitCheckin({ user: SM, input: input({ photoUrls: [url] }), verifyPhoto: async () => true, now: NOW }, fakeDb());
  assert.equal(ok.replayed, false);
});

test("submit: an issue needing PM action notifies the Project Manager; an ordinary one does not", async () => {
  const withIssue = fakeDb();
  await submitCheckin({ user: SM, input: input({ needsPmAction: true, issues: "Cement late" }), now: NOW }, withIssue);
  const note = withIssue.calls.find((c) => c.sql.startsWith("INSERT INTO notifications"));
  assert.ok(note);
  assert.deepEqual([note.params[0], note.params[1], note.params[2]], [ID(2), "CheckinIssue", "Checkin"]);

  const plain = fakeDb();
  await submitCheckin({ user: SM, input: input(), now: NOW }, plain);
  assert.ok(!sqlOf(plain).includes("notifications"));
});

test("submit never changes a task, a milestone, progress or the task photo review", async () => {
  const db = fakeDb();
  await submitCheckin({ user: SM, input: input({ taskIds: [ID(20)], needsPmAction: true, issues: "x" }), now: NOW }, db);
  const text = sqlOf(db);
  assert.ok(!/UPDATE\s+(tasks|milestones|projects)/i.test(text));
  assert.ok(!/task_progress_log|completionPercentage|task_documents/i.test(text.replace("SELECT t.taskId", "")));
});

// ---- review -----------------------------------------------------------------

function reviewDb({ pmId = ID(2) } = {}) {
  const calls = [];
  const client = {
    query: async (text, params) => {
      const sql = text.replace(/\s+/g, " ").trim();
      calls.push({ sql, params });
      if (sql.startsWith("SELECT c.checkinId")) {
        return { rows: [{ checkinid: ID(600), slot: "Midday", day: "2026-10-23", submittedby: SM.id, projectname: "Alpha", projectmanagerid: pmId }], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO daily_progress_reviews")) return { rows: [{ decision: params[2], comment: params[3] }], rowCount: 1 };
      if (sql.startsWith("INSERT INTO notifications")) return { rows: [], rowCount: 1 };
      throw new Error(`Unhandled query: ${sql}`);
    },
  };
  return { calls, withTransaction: async (fn) => fn(client) };
}

test("review: only the project's Project Manager; a Flag needs a comment and tells the Site Manager", async () => {
  await assert.rejects(reviewCheckin({ user: { id: ID(9) }, checkinId: ID(600), decision: "Acknowledged" }, reviewDb()), (e) => e.code === "NOT_YOUR_PROJECT");
  await assert.rejects(reviewCheckin({ user: { id: ID(2) }, checkinId: ID(600), decision: "Flagged", comment: "  " }, reviewDb()), (e) => e.code === "INVALID_FIELDS");
  await assert.rejects(reviewCheckin({ user: { id: ID(2) }, checkinId: ID(600), decision: "Maybe" }, reviewDb()), (e) => e.code === "INVALID_FIELDS");
  await assert.rejects(reviewCheckin({ user: { id: ID(2) }, checkinId: "x", decision: "Acknowledged" }, reviewDb()), (e) => e.code === "CHECKIN_NOT_FOUND");

  const flagged = reviewDb();
  await reviewCheckin({ user: { id: ID(2) }, checkinId: ID(600), decision: "Flagged", comment: "Call the supplier" }, flagged);
  const note = flagged.calls.find((c) => c.sql.startsWith("INSERT INTO notifications"));
  assert.deepEqual([note.params[0], note.params[1]], [SM.id, "CheckinFlagged"]);
  assert.match(note.params[4], /Call the supplier/);

  const acked = reviewDb();
  await reviewCheckin({ user: { id: ID(2) }, checkinId: ID(600), decision: "Acknowledged" }, acked);
  assert.ok(!acked.calls.some((c) => c.sql.startsWith("INSERT INTO notifications")), "acknowledging is quiet");
});

test("detail: the Site Manager reads their own check-in with the PM's review; anyone else gets 404", async () => {
  const row = {
    checkinid: ID(600), projectid: PROJECT, projectname: "Tower A", slot: "Morning", day: "2026-10-23",
    capturedat: "2026-10-23T00:10:00Z", submittedat: "2026-10-23T00:11:00Z", sitestatus: "Delayed", summary: "Rain",
    issues: "No cement", needspmaction: true, ontime: true,
    decision: "Flagged", reviewcomment: "Call the supplier", reviewedat: "2026-10-23T02:00:00Z", reviewedbyname: "Pat PM",
  };
  const calls = [];
  const query = async (sql, params) => {
    calls.push(params);
    if (sql.includes("FROM daily_progress_checkins c")) return params[1] === SM.id ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
    if (sql.includes("daily_checkin_photos")) return { rowCount: 1, rows: [{ photourl: "https://r2.test/checkins/p/a.jpg" }] };
    return { rowCount: 1, rows: [{ taskid: ID(7), taskname: "Pour slab" }] };
  };

  const got = await loadCheckinDetail(SM, ID(600), { query });
  assert.equal(got.slotLabel, "Morning");
  assert.deepEqual(got.photos, ["https://r2.test/checkins/p/a.jpg"]);
  assert.deepEqual(got.tasks, [{ taskId: ID(7), taskName: "Pour slab" }]);
  assert.deepEqual([got.review.decision, got.review.comment], ["Flagged", "Call the supplier"]);

  await assert.rejects(loadCheckinDetail({ id: ID(9) }, ID(600), { query }), (e) => e.code === "CHECKIN_NOT_FOUND");
  await assert.rejects(loadCheckinDetail(SM, "nope", { query }), (e) => e.code === "CHECKIN_NOT_FOUND");
});
