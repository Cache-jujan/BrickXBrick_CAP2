// Unit tests for the identity lock (lib/projectIdentityLock.js): once a project is
// not a Draft any more, the client name and the project type can't change.
const test = require("node:test");
const assert = require("node:assert/strict");

const { assertIdentityUnlocked, lockedIdentityChanges, identityIsLocked } = require("../src/lib/projectIdentityLock");

const row = (status) => ({ status, clientname: "Maria D. Dela Cruz", projecttype: "Residential Building" });
const SAME = { clientName: "Maria D. Dela Cruz", projectType: "Residential Building" };

test("identity lock: only Draft projects can still change the client and type", () => {
  assert.equal(identityIsLocked("Draft"), false);
  for (const status of ["Active", "Suspended"]) assert.equal(identityIsLocked(status), true);
});

test("identity lock: a Draft project may change both", () => {
  assert.deepEqual(lockedIdentityChanges(row("Draft"), { clientName: "Someone Else", projectType: "Civil Works" }), []);
});

test("identity lock: an Active project refuses a new client or a new type", () => {
  const changes = lockedIdentityChanges(row("Active"), { clientName: "Someone Else", projectType: "Civil Works" });
  assert.deepEqual(changes.map((c) => c.field), ["clientName", "projectType"]);
  assert.throws(
    () => assertIdentityUnlocked(row("Active"), { ...SAME, projectType: "Civil Works" }),
    (err) => err.status === 409 && /Project type is locked/.test(err.message)
  );
});

test("identity lock: saving the same values, or only fixing capitals and spaces, is fine", () => {
  assert.deepEqual(lockedIdentityChanges(row("Active"), SAME), []);
  assert.deepEqual(lockedIdentityChanges(row("Active"), { ...SAME, clientName: "  MARIA D. DELA CRUZ " }), []);
});
