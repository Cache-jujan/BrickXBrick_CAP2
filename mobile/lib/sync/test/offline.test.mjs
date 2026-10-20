// Offline-first reads and storage: withCache (network first, saved copy as a
// fallback), the saved settings table and the receipt queue's share of the
// 100-entry rule. Real db.js on Node's SQLite.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
const shim = await import("./expo-sqlite-shim.mjs");
const q = await import("../db.js");
const { withCache, savedAtLabel } = await import("../offline-cache.js");

function fresh() {
  shim.resetShim();
  q.initDb();
}
const net = () => Object.assign(new Error("fetch failed: java.net.SocketException: Connection reset"));

test("online and the server answers: fresh data, and a copy is saved for later", async () => {
  fresh();
  const r = await withCache("tasks", "u1", async () => [{ id: 1 }], { isOnline: true });
  assert.deepEqual(r.data, [{ id: 1 }]);
  assert.equal(r.fromCache, false);
  assert.deepEqual(q.cacheRead("tasks", "u1").data, [{ id: 1 }]);
});

test("offline: the saved copy comes back at once, with its time, and the server is not even asked", async () => {
  fresh();
  q.cacheWrite("tasks", "u1", [{ id: 1 }], "2026-10-20T02:42:00.000Z");
  let asked = false;
  const r = await withCache("tasks", "u1", async () => ((asked = true), []), { isOnline: false });
  assert.equal(asked, false);
  assert.equal(r.fromCache, true);
  assert.equal(r.savedAt, "2026-10-20T02:42:00.000Z");
  assert.deepEqual(r.data, [{ id: 1 }]);
});

test("'online' but the server can't be reached: falls back to the saved copy", async () => {
  fresh();
  q.cacheWrite("tasks", "u1", [{ id: 7 }]);
  const r = await withCache("tasks", "u1", async () => { throw net(); }, { isOnline: true });
  assert.equal(r.fromCache, true);
  assert.deepEqual(r.data, [{ id: 7 }]);
});

test("a real server refusal (403/404) is never hidden behind old data", async () => {
  fresh();
  q.cacheWrite("tasks", "u1", [{ id: 7 }]);
  await assert.rejects(() => withCache("tasks", "u1", async () => { throw new Error("Forbidden: insufficient role"); }, { isOnline: true }), /Forbidden/);
});

test("offline with nothing saved yet: a clear offline error (no fake empty list)", async () => {
  fresh();
  await assert.rejects(() => withCache("tasks", "u1", async () => [], { isOnline: false }), (e) => e.offlineNoCache === true);
});

test("the saved copy is per user: a second person on the phone never sees the first person's data", async () => {
  fresh();
  q.cacheWrite("tasks", "u1", ["u1's task"]);
  await assert.rejects(() => withCache("tasks", "u2", async () => [], { isOnline: false }));
  assert.equal(q.cacheRead("tasks", "u2"), null);
});

test("the saved sign-in survives the app restarting (initDb again on the same file)", () => {
  fresh();
  q.kvSet("session", JSON.stringify({ token: "t", user: { id: "u1" } }));
  q.initDb();
  assert.equal(JSON.parse(q.kvGet("session")).user.id, "u1");
  q.kvDelete("session");
  assert.equal(q.kvGet("session"), null);
});

test("receipts saved offline count toward the shared 100-entry limit", () => {
  fresh();
  for (let i = 0; i < 99; i++) assert.equal(q.queueExpense(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, {}), true);
  const ctx = { mode: "single", ticket: null, fileName: "a.jpg", fileType: "image" };
  assert.equal(q.queueScan({ scanId: "s1", userId: "u1", filePath: "/a", fileName: "a.jpg", fileType: "image", mimeType: "image/jpeg", context: ctx }).queued, true);
  assert.equal(q.getPendingCount(), 100);
  const blocked = q.queueScan({ scanId: "s2", userId: "u1", filePath: "/b", fileName: "b.jpg", fileType: "image", mimeType: "image/jpeg", context: ctx });
  assert.equal(blocked.queued, false);
  assert.equal(blocked.reason, "LIMIT");
  assert.deepEqual(q.getPendingScans("u1")[0].context, ctx); // context comes back as an object
  assert.equal(q.removeQueuedScan("s1"), "/a");
  assert.equal(q.getPendingScanCount(), 0);
});

test("savedAtLabel: time only today, date and time for older copies", () => {
  const now = new Date(2026, 9, 20, 15, 0);
  assert.match(savedAtLabel(new Date(2026, 9, 20, 10, 42).toISOString(), now), /^as of 10:42/);
  assert.match(savedAtLabel(new Date(2026, 9, 18, 9, 5).toISOString(), now), /^as of .*2026.* 9:05|^as of .*18.* 9:05/);
  assert.equal(savedAtLabel(null), "");
});

test("a request that never answers falls back to the saved copy after the time limit", async () => {
  const saved = { data: [{ id: 7 }], savedAt: "2026-01-01T00:00:00.000Z" };
  const r = await withCache("tasks", "u1", () => new Promise(() => {}), {
    isOnline: true,
    timeoutMs: 20,
    cacheRead: () => saved,
    cacheWrite: () => {},
  });
  assert.equal(r.fromCache, true);
  assert.deepEqual(r.data, [{ id: 7 }]);
});

test("a request that never answers and has no saved copy fails with a network error", async () => {
  await assert.rejects(
    withCache("tasks", "u1", () => new Promise(() => {}), {
      isOnline: true,
      timeoutMs: 20,
      cacheRead: () => null,
      cacheWrite: () => {},
    }),
    /timed out/
  );
});
