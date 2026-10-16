// Dev flag: EXPO_PUBLIC_QUEUE_LIMIT=3 lowers the queue limit, in dev builds only.
// Runs in its own process because the limit is read once, when db.js loads.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);

test("with the dev flag set to 3, the 4th entry is blocked", async () => {
  process.env.EXPO_PUBLIC_QUEUE_LIMIT = "3";
  globalThis.__DEV__ = true;
  const q = await import("../db.js");
  q.initDb();
  for (let i = 1; i <= 3; i++) assert.equal(q.queueTaskUpdate({ updateId: `u${i}`, taskId: `t${i}`, userId: "x", photoPath: "/p" }).queued, true);
  const fourth = q.queueTaskUpdate({ updateId: "u4", taskId: "t4", userId: "x", photoPath: "/p" });
  assert.equal(fourth.queued, false);
  assert.match(fourth.message, /3 entries/);
});

test("the flag is ignored outside dev builds (limit stays 100)", async () => {
  // fresh import under different conditions: use a query string to defeat the module cache
  process.env.EXPO_PUBLIC_QUEUE_LIMIT = "3";
  globalThis.__DEV__ = false;
  const q = await import("../db.js?release");
  q.initDb();
  for (let i = 1; i <= 4; i++) assert.equal(q.queueTaskUpdate({ updateId: `r${i}`, taskId: `rt${i}`, userId: "x", photoPath: "/p" }).queued, true);
});
