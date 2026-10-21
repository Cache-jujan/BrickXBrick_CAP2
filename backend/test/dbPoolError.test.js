const test = require("node:test");
const assert = require("node:assert/strict");

// A dropped idle connection must not crash the server: the pool needs an
// 'error' listener, because an unhandled 'error' event kills the process.
test("the shared pool survives an idle-connection error", () => {
  const { pool } = require("../src/lib/db");
  assert.ok(pool.listenerCount("error") >= 1);

  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    assert.doesNotThrow(() => pool.emit("error", new Error("Connection terminated unexpectedly")));
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.match(logged[0], /Connection terminated unexpectedly/);
});
