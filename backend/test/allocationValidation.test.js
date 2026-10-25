// Validation tests for the F8 allocation request body. No database needed.
const test = require("node:test");
const assert = require("node:assert/strict");

// ---- lineTargets ---------------------------------------------------------------------------

const { parseLineTargets } = require("../src/lib/allocationValidation");

test("lineTargets accepts a valid line index and ticket id, in any case", () => {
  const lines = [{ lineIndex: 0 }, { lineIndex: 1 }];
  const id = "00000000-0000-4000-8000-00000000000A";
  assert.deepEqual(parseLineTargets({ 1: id }, lines), { 1: id.toLowerCase() });
  assert.deepEqual(parseLineTargets(undefined, lines), {});
});

test("lineTargets refuses a bad index, a bad id, or a non-object", () => {
  const lines = [{ lineIndex: 0 }];
  assert.throws(() => parseLineTargets({ 3: "00000000-0000-4000-8000-00000000000a" }, lines), /not a valid line index/);
  assert.throws(() => parseLineTargets({ 0: "nope" }, lines), /valid ticket UUID/);
  assert.throws(() => parseLineTargets([], lines), /must be an object/);
});
