// F10 wording (lib/sync/messages.js): one plain message per sync run.
import test from "node:test";
import assert from "node:assert/strict";
import { describeRejection, buildSyncSummary, describeLoadError, isNetworkError, bannerState, SENT_SHOW_MS } from "../messages.js";

const result = (over = {}) => ({
  synced: 0, rejected: 0,
  expenses: { synced: 0, rejected: 0 }, tasks: { synced: 0, rejected: 0 },
  rejectedItems: [], ...over,
});

test("the three reasons a user will actually see are in plain words", () => {
  assert.match(describeRejection("TASK_NOT_YOURS"), /reassigned/);
  assert.match(describeRejection("TASK_CLOSED"), /already completed/);
  assert.match(describeRejection("SUPERSEDED"), /waiting for review/);
});

test("an unknown code falls back to the server's message, then to a generic line", () => {
  assert.equal(describeRejection("SOMETHING_NEW", "Server says no"), "Server says no");
  assert.match(describeRejection("SOMETHING_NEW"), /could not accept/);
});

test("nothing happened: no message (so no alert)", () => {
  assert.equal(buildSyncSummary(result()), null);
  assert.equal(buildSyncSummary(undefined), null);
});

test("task updates synced: counted separately from expenses, singular/plural right", () => {
  const one = buildSyncSummary(result({ synced: 1, tasks: { synced: 1, rejected: 0 } }));
  assert.equal(one.title, "Sync complete");
  assert.equal(one.message, "1 task update sent for review");
  const both = buildSyncSummary(result({ synced: 3, expenses: { synced: 2, rejected: 0 }, tasks: { synced: 1, rejected: 0 } }));
  assert.equal(both.message, "2 expenses synced\n1 task update sent for review");
});

test("rejections list the plain reason for task updates and the code for expenses", () => {
  const summary = buildSyncSummary(result({
    rejected: 2,
    rejectedItems: [
      { kind: "task_update", code: "TASK_NOT_YOURS", message: "x" },
      { kind: "expense", code: "INVALID_AMOUNT", message: "bad amount" },
    ],
  }));
  assert.equal(
    summary.message,
    "2 not synced\n• This task was reassigned to someone else, so your update was not sent.\n• INVALID_AMOUNT: bad amount"
  );
});

test("at most 3 reasons are listed, then 'and N more'", () => {
  const items = Array.from({ length: 5 }, () => ({ kind: "task_update", code: "SUPERSEDED", message: "" }));
  const summary = buildSyncSummary(result({ rejected: 5, rejectedItems: items }));
  assert.equal(summary.message.split("\n").length, 5); // "5 not synced" + 3 reasons + "and 2 more"
  assert.match(summary.message, /• and 2 more$/);
});

// ---- loading errors ----------------------------------------------------------------

test("offline: no error text at all (the banner already says offline)", () => {
  assert.equal(describeLoadError(new Error("Network request failed"), false), null);
  assert.equal(describeLoadError("Something else broke", false), null);
});

test("online + network failure: one plain sentence, never the raw 'Network request failed'", () => {
  for (const raw of ["Network request failed", "Failed to fetch", "Request timed out", "TypeError: network error"]) {
    const text = describeLoadError(new Error(raw), true);
    assert.match(text, /Can't reach the server right now/, raw);
    assert.doesNotMatch(text, /Network request failed/);
  }
});

test("online + a real server message: shown as is; no error: nothing", () => {
  assert.equal(describeLoadError(new Error("This task is no longer assigned to your account."), true), "This task is no longer assigned to your account.");
  assert.equal(describeLoadError(null, true), null);
  assert.equal(isNetworkError("Network request failed"), true);
  assert.equal(isNetworkError(new Error("Project not found")), false);
});

// ---- the status strip -------------------------------------------------------------------

const NOW = 1_000_000;
const strip = (over) => bannerState({ isOnline: true, pendingCount: 0, syncing: false, lastSync: null, now: NOW, ...over });

test("offline: red strip with the queued count", () => {
  assert.deepEqual(strip({ isOnline: false }), { tone: "offline", text: "You're offline" });
  assert.deepEqual(strip({ isOnline: false, pendingCount: 2 }), { tone: "offline", text: "You're offline · 2 queued" });
});

test("back online and sending: blue 'sending' strip", () => {
  assert.equal(strip({ pendingCount: 1, syncing: true }).tone, "sending");
});

test("tried but still queued (server down or photo not uploaded): amber 'waiting', even while it retries", () => {
  const stuck = { at: NOW - 1000, result: { synced: 0, postponedItems: [{ id: "u1" }] } };
  assert.equal(strip({ pendingCount: 1, lastSync: stuck }).tone, "waiting");
  assert.equal(strip({ pendingCount: 1, lastSync: stuck, syncing: true }).tone, "waiting"); // no flicker on retries
  assert.equal(strip({ pendingCount: 1, lastSync: { at: NOW, error: "Sync failed: 503" } }).tone, "waiting");
  assert.match(strip({ pendingCount: 1, lastSync: stuck }).text, /1 update waiting to send/);
});

test("all sent: green strip for a few seconds, then nothing", () => {
  const sent = { at: NOW - 1000, result: { synced: 2, postponedItems: [] } };
  assert.deepEqual(strip({ lastSync: sent }), { tone: "sent", text: "All caught up · 2 updates sent" });
  assert.equal(strip({ lastSync: { ...sent, at: NOW - SENT_SHOW_MS - 1 } }), null);
});

test("online with nothing queued and nothing recent: no strip", () => {
  assert.equal(strip({}), null);
  assert.equal(strip({ pendingCount: 1 }), null); // queued, not tried yet: the sync starts by itself
});
