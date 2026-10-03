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