// The "username.role" label shown on the organizational side (displayName.js).
const test = require("node:test");
const assert = require("node:assert/strict");

const { USERNAME_RE, roleSlug, orgName } = require("../src/lib/displayName");

test("a person shows as username.role", () => {
  assert.equal(roleSlug("Site Manager"), "site-manager");
  assert.equal(orgName("jala", "Site Manager"), "jala.site-manager");
  assert.equal(orgName("chels", "Purchaser"), "chels.purchaser");
});

test("usernames are 3-30 letters, numbers or underscores", () => {
  assert.ok(USERNAME_RE.test("jala_95"));
  assert.ok(!USERNAME_RE.test("ab"));
  assert.ok(!USERNAME_RE.test("has space"));
  assert.ok(!USERNAME_RE.test("dot.name"));
  assert.ok(!USERNAME_RE.test("x".repeat(31)));
});
