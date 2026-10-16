// F10 wording (lib/sync/messages.js): one plain message per sync run.
import test from "node:test";
import assert from "node:assert/strict";
import { describeRejection, buildSyncSummary } from "../messages.js";

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
