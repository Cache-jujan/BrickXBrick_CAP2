const test = require("node:test");
const assert = require("node:assert/strict");

const { parseNeededBy } = require("../src/lib/neededBy");

const NOW = new Date(2026, 9, 21, 9, 0, 0); // 21 Oct 2026, local time

test("no date given returns null", () => {
  assert.equal(parseNeededBy(undefined, NOW), null);
  assert.equal(parseNeededBy(null, NOW), null);
  assert.equal(parseNeededBy("", NOW), null);
});

test("today and future dates are accepted", () => {
  assert.equal(parseNeededBy("2026-10-21", NOW), "2026-10-21");
  assert.equal(parseNeededBy("2026-12-01", NOW), "2026-12-01");
});

test("a past date is rejected with status 400", () => {
  assert.throws(() => parseNeededBy("2026-10-20", NOW), (err) => err.status === 400);
});

test("a wrong format is rejected", () => {
  for (const bad of ["21/10/2026", "2026-1-5", "tomorrow", 20261021]) {
    assert.throws(() => parseNeededBy(bad, NOW), (err) => err.status === 400, String(bad));
  }
});

test("an impossible calendar date is rejected", () => {
  assert.throws(() => parseNeededBy("2026-02-30", NOW), (err) => err.status === 400);
});
