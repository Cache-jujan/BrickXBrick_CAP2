// recordFailedAttempt counts a wrong password in one statement.
const test = require("node:test");
const assert = require("node:assert/strict");

const { recordFailedAttempt, MAX_ATTEMPTS, LOCKOUT_MINUTES } = require("../src/lib/loginLockout");

function fakeQuery(result) {
  const calls = [];
  const runQuery = async (sql, params) => {
    calls.push({ sql: String(sql).replace(/\s+/g, " ").trim().toLowerCase(), params });
    return result;
  };
  return { runQuery, calls };
}

test("a wrong password is counted with one UPDATE that adds 1 inside the database", async () => {
  const { runQuery, calls } = fakeQuery({ rowCount: 1, rows: [{ failedloginattempts: 1, locked: false }] });
  await recordFailedAttempt(runQuery, "u1");
  assert.equal(calls.length, 1, "no separate read of the counter");
  assert.ok(calls[0].sql.startsWith("update users"));
  assert.ok(calls[0].sql.includes("failedloginattempts + 1"));
  assert.ok(!calls[0].sql.includes("select"));
  assert.ok(calls[0].sql.includes("where userid = $1"));
});

test("it sends the user, the limit, the lock time and the current time", async () => {
  const { runQuery, calls } = fakeQuery({ rowCount: 1, rows: [{ failedloginattempts: 1, locked: false }] });
  const now = new Date("2026-11-16T10:00:00.000Z");
  await recordFailedAttempt(runQuery, "u1", now);
  const [id, limit, lockUntil, sentNow] = calls[0].params;
  assert.equal(id, "u1");
  assert.equal(limit, MAX_ATTEMPTS);
  assert.equal(lockUntil.getTime() - now.getTime(), LOCKOUT_MINUTES * 60 * 1000);
  assert.equal(sentNow.getTime(), now.getTime());
});

test("not locked yet: reports how many tries are left", async () => {
  const { runQuery } = fakeQuery({ rowCount: 1, rows: [{ failedloginattempts: 3, locked: false }] });
  assert.deepEqual(await recordFailedAttempt(runQuery, "u1"), { locked: false, attemptsLeft: 2 });
});

test("the attempt that reaches the limit reports locked", async () => {
  const { runQuery } = fakeQuery({ rowCount: 1, rows: [{ failedloginattempts: 0, locked: true }] });
  assert.deepEqual(await recordFailedAttempt(runQuery, "u1"), { locked: true, attemptsLeft: 0 });
});

test("an account that an earlier request already locked (no row updated) reports locked", async () => {
  const { runQuery } = fakeQuery({ rowCount: 0, rows: [] });
  assert.deepEqual(await recordFailedAttempt(runQuery, "u1"), { locked: true, attemptsLeft: 0 });
});
