// Trip-cost split tests (tripCostPlan.js). No database needed.
const test = require("node:test");
const assert = require("node:assert/strict");
const { splitTripCost } = require("../src/lib/tripCostPlan");

const sum = (portions) => portions.reduce((total, p) => total + p.amountCents, 0);

test("an even total splits evenly", () => {
  const result = splitTripCost(150000, ["a", "b", "c"]);
  assert.deepEqual(result.map((p) => p.amountCents), [50000, 50000, 50000]);
});

test("leftover centavos go to the first projects, one each, and nothing is lost", () => {
  const result = splitTripCost(100001, ["a", "b", "c"]);
  assert.deepEqual(result.map((p) => p.amountCents), [33334, 33334, 33333]);
  assert.equal(sum(result), 100001);
});

test("one project takes the whole amount", () => {
  assert.deepEqual(splitTripCost(2599, ["a"]), [{ projectID: "a", amountCents: 2599 }]);
});

test("a repeated project is only charged once", () => {
  const result = splitTripCost(1000, ["a", "a", "b"]);
  assert.deepEqual(result.map((p) => p.projectID), ["a", "b"]);
  assert.equal(sum(result), 1000);
});

test("a total smaller than the number of projects still adds up", () => {
  const result = splitTripCost(2, ["a", "b", "c"]);
  assert.deepEqual(result.map((p) => p.amountCents), [1, 1, 0]);
});

test("bad input is refused", () => {
  assert.throws(() => splitTripCost(0, ["a"]));
  assert.throws(() => splitTripCost(10.5, ["a"]));
  assert.throws(() => splitTripCost(1000, []));
});
