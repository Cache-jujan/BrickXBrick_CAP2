// SIGTERM handling: in-flight requests finish, new ones are refused, timers
// stop first, a running background pass is waited for, the DB closes last,
// and a stuck shutdown still ends within the time limit.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const { createGracefulShutdown } = require("../src/lib/gracefulShutdown");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(handlers = {}) {
  const app = express();
  app.get("/fast", (req, res) => res.json({ ok: true }));
  app.get("/slow", async (req, res) => { await sleep(300); res.json({ done: true }); });
  Object.assign(app, handlers);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

/** Build the shutdown with recording fakes for everything except the real server. */
function build(server, extra = {}) {
  const events = [];
  const exits = [];
  const shutdown = createGracefulShutdown({
    server,
    stopTimers: () => events.push("timers"),
    closeDb: async () => { events.push("db"); },
    log: () => {},
    exit: (code) => exits.push(code),
    pollMs: 20,
    ...extra,
  });
  return { shutdown, events, exits };
}

test("an in-flight request finishes, then the DB closes and the process exits 0", async () => {
  const { server, url } = await start();
  const { shutdown, events, exits } = build(server);
  const pending = fetch(`${url}/slow`).then((r) => r.json());
  await sleep(50);
  const done = shutdown("SIGTERM");
  assert.deepEqual(await pending, { done: true }, "the request in progress still gets its answer");
  await done;
  assert.deepEqual(events, ["timers", "db"]);
  assert.deepEqual(exits, [0]);
});

test("new connections are refused once shutdown has started", async () => {
  const { server, url } = await start();
  const { shutdown } = build(server);
  const pending = fetch(`${url}/slow`).then((r) => r.json());
  await sleep(50);
  const done = shutdown("SIGTERM");
  await sleep(50);
  await assert.rejects(fetch(`${url}/fast`, { signal: AbortSignal.timeout(1000) }));
  await pending;
  await done;
});

test("an idle keep-alive connection does not hold shutdown up", async () => {
  const { server, url } = await start();
  const { shutdown, exits } = build(server, { timeoutMs: 3000 });
  await (await fetch(`${url}/fast`)).json(); // leaves a keep-alive connection open
  const started = Date.now();
  await shutdown("SIGTERM");
  assert.deepEqual(exits, [0]);
  assert.ok(Date.now() - started < 1500, "finished long before the time limit");
});

test("a background pass that is already running is waited for before the DB closes", async () => {
  const { server } = await start();
  let busy = true;
  const { shutdown, events, exits } = build(server, { isBusy: () => busy });
  const done = shutdown("SIGTERM");
  await sleep(150);
  assert.deepEqual(events, ["timers"], "DB is still open while a pass is running");
  busy = false;
  await done;
  assert.deepEqual(events, ["timers", "db"]);
  assert.deepEqual(exits, [0]);
});

test("a shutdown that cannot finish exits 1 at the time limit", async () => {
  const { server } = await start();
  const { shutdown, events, exits } = build(server, { isBusy: () => true, timeoutMs: 250 });
  const done = shutdown("SIGTERM");
  await sleep(500);
  await done; // the wait loop gives up once the limit has passed
  assert.deepEqual(exits, [1], "exited once, with 1, and did not go on to exit 0");
  assert.ok(!events.includes("db"), "never got as far as closing the DB");
});

test("calling it twice runs the shutdown once", async () => {
  const { server } = await start();
  const { shutdown, events, exits } = build(server);
  await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);
  assert.deepEqual(events, ["timers", "db"]);
  assert.deepEqual(exits, [0]);
});

test("a failing DB close exits 1", async () => {
  const { server } = await start();
  const { shutdown, exits } = build(server, { closeDb: async () => { throw new Error("pool broke"); } });
  await shutdown("SIGTERM");
  assert.deepEqual(exits, [1]);
});
