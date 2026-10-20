// The banner only pops for notifications created after the last one seen.
import test from "node:test";
import assert from "node:assert/strict";

const { pickNewNotifications } = await import("../new-notifications.js");

const row = (id, createdat, isread = false) => ({ notificationid: id, createdat, isread });

test("first run: nothing pops, but the newest time is remembered", () => {
  const r = pickNewNotifications([row("a", "2026-10-20T10:00:00Z"), row("b", "2026-10-20T11:00:00Z")], null);
  assert.deepEqual(r.fresh, []);
  assert.equal(r.newestAt, "2026-10-20T11:00:00Z");
});

test("only unread notifications newer than the last seen pop, newest first", () => {
  const r = pickNewNotifications(
    [
      row("old", "2026-10-20T09:00:00Z"),
      row("new1", "2026-10-20T12:00:00Z"),
      row("new2", "2026-10-20T13:00:00Z"),
      row("readAlready", "2026-10-20T14:00:00Z", true),
    ],
    "2026-10-20T10:00:00Z"
  );
  assert.deepEqual(r.fresh.map((n) => n.notificationid), ["new2", "new1"]);
  assert.equal(r.newestAt, "2026-10-20T14:00:00Z");
});

test("nothing new keeps the last seen time", () => {
  const r = pickNewNotifications([row("old", "2026-10-20T09:00:00Z")], "2026-10-20T10:00:00Z");
  assert.deepEqual(r.fresh, []);
  assert.equal(r.newestAt, "2026-10-20T10:00:00Z");
});
