// Daily check-ins on the phone: the pure rules, the offline queue, and the sync
// (photos first, one batch, idempotent retries). Run from mobile/:  npm test
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
const shim = await import("./expo-sqlite-shim.mjs");
const { fs } = await import("./file-system-shim.mjs");
const { setSession, refresh } = await import("./auth-shim.mjs");
const q = await import("../db.js");
const { syncAllPending } = await import("../sync.js");
const rules = await import("../checkin.js");
const { buildSyncSummary, describeCheckinRejection } = await import("../messages.js");

const SM = { token: "t", user: { id: "sm-1", role: "Site Manager" } };
const PURCHASER = { token: "t", user: { id: "p-1", role: "Purchaser" } };
let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const PROJECT = uid();

let batches;
let serverReply;
function setup(session = SM) {
  shim.resetShim();
  q.initDb();
  fs.reset();
  batches = [];
  serverReply = async (items) => ({ body: { syncedIds: items.map((i) => i.uuid), rejected: [] } });
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    batches.push(body);
    const reply = await serverReply(body.items);
    return { ok: (reply.status ?? 200) < 300, status: reply.status ?? 200, json: async () => reply.body };
  };
  setSession(session);
  refresh.outcome = "unavailable";
  let k = 0;
  fs.uploadHandler = async () => ({ status: 201, body: JSON.stringify({ photoUrl: `https://r2/checkins/${PROJECT}/p${++k}.jpg` }) });
}

function queue(extra = {}) {
  const photoPaths = extra.photoPaths ?? [];
  photoPaths.forEach((p) => fs.existing.add(p));
  const clientId = extra.clientId ?? uid();
  const res = q.queueCheckin({
    clientId, userId: "sm-1", projectId: PROJECT, checkinDate: "2026-10-23", slot: "Midday",
    capturedAt: "2026-10-23T03:00:00.000Z", siteStatus: "On Track", summary: "Slab poured",
    ...extra, photoPaths,
  });
  return { clientId, res };
}

// ---- rules ------------------------------------------------------------------

test("manilaDate is the Philippine day, whatever the phone's zone", () => {
  assert.equal(rules.manilaDate(new Date("2026-10-22T17:00:00Z")), "2026-10-23");
  assert.equal(rules.manilaDate(new Date("2026-10-22T15:59:00Z")), "2026-10-22");
});

test("checkinProblems lists what is missing in plain words", () => {
  const ok = { projectId: PROJECT, slot: "Morning", siteStatus: "Delayed", summary: "x" };
  assert.deepEqual(rules.checkinProblems(ok), []);
  assert.equal(rules.checkinProblems({}).length, 4);
  assert.match(rules.checkinProblems({ ...ok, needsPmAction: true })[0], /issue/i);
  assert.deepEqual(rules.checkinProblems({ ...ok, needsPmAction: true, issues: "Cement late" }), []);
  assert.equal(rules.checkinProblems({ ...ok, summary: "   " }).length, 1);
  assert.equal(rules.checkinProblems({ ...ok, photoCount: 4 }).length, 1);
});

test("a queued slot shows as Queued unless the server already has it", () => {
  const server = [
    { slot: "Morning", state: "Submitted" },
    { slot: "Midday", state: "Open" },
    { slot: "EndOfDay", state: "Upcoming" },
  ];
  const pending = [{ project_id: PROJECT, slot: "Midday" }, { project_id: PROJECT, slot: "Morning" }, { project_id: "other", slot: "EndOfDay" }];
  assert.deepEqual(rules.slotStates(server, pending, PROJECT).map((s) => s.state), ["Submitted", "Queued", "Upcoming"]);
});

// ---- queue ------------------------------------------------------------------

test("a saved check-in counts toward the one offline limit", () => {
  setup();
  queue();
  assert.equal(q.getPendingCheckinCount(), 1);
  assert.equal(q.getPendingCount(), 1);
});

test("saving the same slot again replaces the waiting one and hands back its photo files", () => {
  setup();
  const first = queue({ photoPaths: ["/docs/a.jpg"] });
  const second = queue({ summary: "Updated", photoPaths: ["/docs/b.jpg"] });
  assert.deepEqual(second.res.replacedPhotoPaths, ["/docs/a.jpg"]);
  const rows = q.getPendingCheckins("sm-1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].summary, "Updated");
  assert.notEqual(rows[0].client_id, first.clientId);
});

test("a different slot or project is a separate entry", () => {
  setup();
  queue();
  queue({ slot: "EndOfDay" });
  assert.equal(q.getPendingCheckinCount(), 2);
});

test("the 100-entry rule applies, but replacing a waiting check-in is still allowed at the limit", () => {
  setup();
  for (let i = 0; i < 99; i += 1) assert.equal(q.queueCheckin({
    clientId: uid(), userId: "sm-1", projectId: uid(), checkinDate: "2026-10-23", slot: "Morning",
    capturedAt: "2026-10-23T01:00:00.000Z", siteStatus: "On Track", summary: "x",
  }).queued, true);
  assert.equal(queue().res.queued, true); // the 100th
  const full = queue({ slot: "EndOfDay" }).res;
  assert.equal(full.queued, false);
  assert.equal(full.reason, "LIMIT");
  assert.equal(queue({ summary: "again" }).res.queued, true); // replaces, so no extra entry
});

// ---- sync -------------------------------------------------------------------

test("photos upload first (with the project id); the batch carries only URLs", async () => {
  setup();
  const { clientId } = queue({ photoPaths: ["/docs/a.jpg", "/docs/b.png"], taskIds: [uid()], issues: "Cement late", needsPmAction: true });
  const result = await syncAllPending();

  assert.equal(fs.uploads.length, 2);
  assert.equal(fs.uploads[0].url, "http://api.test/api/checkins/photo");
  assert.deepEqual(fs.uploads[0].options.parameters, { projectId: PROJECT });
  assert.equal(fs.uploads[1].options.mimeType, "image/png");

  const item = batches[0].items[0];
  assert.equal(item.uuid, clientId);
  assert.equal(item.type, "daily_checkin");
  assert.equal(item.data.projectId, PROJECT);
  assert.equal(item.data.slot, "Midday");
  assert.equal(item.data.needsPmAction, true);
  assert.equal(item.data.issues, "Cement late");
  assert.equal(item.data.photoUrls.length, 2);
  assert.equal(item.data.taskIds.length, 1);

  assert.equal(result.checkins.synced, 1);
  assert.equal(result.synced, 1);
  assert.equal(q.getPendingCount(), 0);
  assert.deepEqual(fs.deleted.sort(), ["/docs/a.jpg", "/docs/b.png"]);
});

test("optional fields are left out; an empty issue is not sent", async () => {
  setup();
  queue();
  await syncAllPending();
  assert.equal("issues" in batches[0].items[0].data, false);
  assert.deepEqual(batches[0].items[0].data.photoUrls, []);
});

test("a failed batch keeps the check-in, and the retry reuses the SAME id and does not upload photos twice", async () => {
  setup();
  const { clientId } = queue({ photoPaths: ["/docs/a.jpg"] });
  serverReply = async () => { throw new Error("Network request failed"); };
  await assert.rejects(() => syncAllPending(), /Network request failed/);
  assert.equal(fs.uploads.length, 1);
  assert.equal(q.getPendingCheckins("sm-1")[0].server_photo_urls.length, 1);

  serverReply = async (items) => ({ body: { syncedIds: items.map((i) => i.uuid), rejected: [] } });
  const result = await syncAllPending();
  assert.equal(fs.uploads.length, 1);
  assert.equal(batches.at(-1).items[0].uuid, clientId);
  assert.equal(result.checkins.synced, 1);
});

test("a photo that fails halfway resumes where it stopped", async () => {
  setup();
  queue({ photoPaths: ["/docs/a.jpg", "/docs/b.jpg"] });
  let calls = 0;
  const ok = fs.uploadHandler;
  fs.uploadHandler = async (...a) => { calls += 1; if (calls === 2) throw new Error("Network request failed"); return ok(...a); };
  const result = await syncAllPending();
  assert.equal(result.postponedItems.length, 1);
  assert.equal(batches.length, 0); // nothing half-sent
  assert.equal(q.getPendingCheckins("sm-1")[0].server_photo_urls.length, 1);

  fs.uploadHandler = ok;
  await syncAllPending();
  assert.equal(fs.uploads.length, 3); // 2 attempts + only the missing one
  assert.equal(batches[0].items[0].data.photoUrls.length, 2);
});

test("the server refusing a check-in rejects it with a readable reason and keeps it for the user to see", async () => {
  setup();
  const { clientId } = queue();
  serverReply = async () => ({ body: { syncedIds: [], rejected: [{ id: clientId, code: "DUPLICATE_CHECKIN", message: "exists" }] } });
  const result = await syncAllPending();
  assert.equal(result.checkins.rejected, 1);
  const rejected = q.getRejectedCheckins("sm-1");
  assert.equal(rejected[0].error_code, "DUPLICATE_CHECKIN");
  assert.match(describeCheckinRejection("DUPLICATE_CHECKIN", "exists"), /already sent/);
  assert.match(buildSyncSummary(result).message, /already sent/);
  assert.deepEqual(q.dismissRejectedCheckin(clientId), []);
  assert.equal(q.getRejectedCheckins("sm-1").length, 0);
});

test("a permanent photo refusal rejects the check-in; a temporary one leaves it queued", async () => {
  setup();
  const a = queue({ photoPaths: ["/docs/a.jpg"] });
  fs.uploadHandler = async () => ({ status: 409, body: JSON.stringify({ error: "not active" }) });
  const result = await syncAllPending();
  assert.equal(result.checkins.rejected, 1);
  assert.equal(q.getRejectedCheckins("sm-1")[0].error_code, "PROJECT_NOT_ACTIVE");
  assert.equal(batches.length, 0);
  assert.ok(a.clientId);

  setup();
  queue({ photoPaths: ["/docs/a.jpg"] });
  fs.uploadHandler = async () => ({ status: 503, body: "" });
  const again = await syncAllPending();
  assert.equal(again.postponedItems.length, 1);
  assert.equal(q.getPendingCheckinCount(), 1);
});

test("a check-in whose photo file vanished is rejected, not retried for ever", async () => {
  setup();
  queue({ photoPaths: ["/docs/a.jpg"] });
  fs.existing.delete("/docs/a.jpg");
  const result = await syncAllPending();
  assert.equal(result.checkins.rejected, 1);
  assert.equal(q.getRejectedCheckins("sm-1")[0].error_code, "MISSING_PHOTO");
});

test("only the signed-in Site Manager's own check-ins are sent", async () => {
  setup(PURCHASER);
  queue();
  await syncAllPending();
  assert.equal(batches.length, 0);
  assert.equal(q.getPendingCheckinCount(), 1);

  setup({ token: "t", user: { id: "sm-2", role: "Site Manager" } });
  queue();
  await syncAllPending();
  assert.equal(batches.length, 0); // belongs to sm-1
});

test("the sync summary names sent check-ins", async () => {
  setup();
  queue();
  assert.match(buildSyncSummary(await syncAllPending()).message, /1 check-in sent/);
});
