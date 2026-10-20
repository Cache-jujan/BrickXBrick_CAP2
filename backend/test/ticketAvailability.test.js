// A request counts as fulfilled once its non-Rejected expenses cover the
// requested quantity. A receipt scanned earlier must not be submittable then.
const test = require("node:test");
const assert = require("node:assert/strict");
const { isFulfilled, isTicketFulfilled } = require("../src/lib/ticketAvailability");

test("no expenses yet: the request is still open", () => {
  assert.equal(isFulfilled(60, { count: 0, quantity: 0 }), false);
  assert.equal(isFulfilled(null, { count: 0, quantity: 0 }), false);
});

test("a partly filled request is still open, a fully filled one is not", () => {
  assert.equal(isFulfilled(60, { count: 1, quantity: 40 }), false);
  assert.equal(isFulfilled(60, { count: 2, quantity: 60 }), true);
  assert.equal(isFulfilled(60, { count: 2, quantity: 60.5 }), true);
});

test("decimal quantities compare exactly", () => {
  assert.equal(isFulfilled(0.3, { count: 1, quantity: 0.1 + 0.2 }), true);
  assert.equal(isFulfilled(2.5, { count: 1, quantity: 2.49 }), false);
});

test("a request with no quantity is fulfilled by any expense", () => {
  assert.equal(isFulfilled(null, { count: 1, quantity: 0 }), true);
});

test("isTicketFulfilled asks only about non-Rejected expenses of that ticket", async () => {
  const calls = [];
  const run = async (sql, params) => {
    calls.push({ sql: sql.replace(/\s+/g, " "), params });
    return { rows: [{ count: 1, quantity: "60.00" }] };
  };
  assert.equal(await isTicketFulfilled(run, "t-1", "60.00"), true);
  assert.deepEqual(calls[0].params, ["t-1"]);
  assert.match(calls[0].sql, /status <> 'Rejected'/);
});

test("an empty result (no rows) means nothing is charged yet", async () => {
  assert.equal(await isTicketFulfilled(async () => ({ rows: [] }), "t-1", 10), false);
});
