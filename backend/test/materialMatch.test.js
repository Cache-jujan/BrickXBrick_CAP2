const test = require("node:test");
const assert = require("node:assert/strict");

const { matchesMaterial } = require("../src/lib/materialMatch");

test("Portland Cement 40kg matches cement", () => {
  assert.equal(matchesMaterial("Portland Cement 40kg", "cement"), true);
});

test("word order and punctuation don't matter", () => {
  assert.equal(matchesMaterial("CEMENT, PORTLAND TYPE-1", "portland cement"), true);
});

test("trailing s is dropped: Rebars matches rebar", () => {
  assert.equal(matchesMaterial("Rebars 10mm", "rebar"), true);
});

test("whole words only: Sandpaper does not match sand", () => {
  assert.equal(matchesMaterial("Sandpaper #80", "sand"), false);
});

test("synonyms don't match (known limit)", () => {
  assert.equal(matchesMaterial("Deformed bars 10mm", "rebar"), false);
});

test("extra spaces are ignored", () => {
  assert.equal(matchesMaterial("   Portland    cement   ", "  portland   cement "), true);
});

test("punctuation becomes word breaks", () => {
  assert.equal(matchesMaterial("cement/portland(40kg)", "portland-cement"), true);
});

test("bags matches bag both ways", () => {
  assert.equal(matchesMaterial("Cement 40kg bags", "cement bag"), true);
  assert.equal(matchesMaterial("Cement 40kg bag", "cement bags"), true);
});

test("every request word must appear", () => {
  assert.equal(matchesMaterial("Portland cement", "white cement"), false);
});

test("empty or missing materialType never matches", () => {
  assert.equal(matchesMaterial("Portland cement", ""), false);
  assert.equal(matchesMaterial("Portland cement", "   "), false);
  assert.equal(matchesMaterial("Portland cement", null), false);
});

test("empty description doesn't match a real material", () => {
  assert.equal(matchesMaterial("", "cement"), false);
  assert.equal(matchesMaterial(undefined, "cement"), false);
});

test("a line with no size matches a request that has one", () => {
  assert.equal(matchesMaterial("Portland cement", "Portland cement 40kg"), true);
});

test("a line with a different size does not match", () => {
  assert.equal(matchesMaterial("Portland cement 50kg", "Portland cement 40kg"), false);
  assert.equal(matchesMaterial("Rebar 12mm", "Rebar 10mm"), false);
});

test("the same size written with a space still matches", () => {
  assert.equal(matchesMaterial("Portland cement 40 kg", "Portland cement 40kg"), true);
  assert.equal(matchesMaterial("Rebar 10 mm", "rebar 10mm"), true);
});

test("a missing size never rescues a missing name word", () => {
  assert.equal(matchesMaterial("Cement", "Portland cement 40kg"), false);
});
