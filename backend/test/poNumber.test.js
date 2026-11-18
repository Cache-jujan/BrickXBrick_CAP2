// Sequential PO numbers: format, and that each call takes the next number from the counter.
const test = require("node:test");
const assert = require("node:assert/strict");
const { PO_ROLES, formatPoNumber, nextPoNumber } = require("../src/lib/poNumber");
const { ALLOCATION_ROLES } = require("../src/lib/openRequests");

test("formatPoNumber pads to three digits and keeps longer numbers whole", () => {
  assert.equal(formatPoNumber(2026, 1), "PO-2026-001");
  assert.equal(formatPoNumber(2026, 14), "PO-2026-014");
  assert.equal(formatPoNumber(2026, 1234), "PO-2026-1234");
});

test("nextPoNumber turns the counter row into a PO number with one query", async () => {
  const calls = [];
  const run = async (sql) => { calls.push(sql); return { rows: [{ year: 2026, lastnumber: 14 }] }; };
  assert.equal(await nextPoNumber(run), "PO-2026-014");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /ON CONFLICT \(year\) DO UPDATE/); // atomic: no read-then-write race
});

test("the roles that can get a PO number are exactly the roles that can see open requests", () => {
  assert.deepEqual([...PO_ROLES].sort(), [...ALLOCATION_ROLES].sort());
  assert.ok(!PO_ROLES.includes("System Administrator"));
  assert.ok(!PO_ROLES.includes("Accountant"));
});
