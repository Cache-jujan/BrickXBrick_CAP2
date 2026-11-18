// Unit tests for the date lock (lib/projectDateLock.js): once a project is
// Active, the target date of development and the target date of construction
// can't change; the completion date can.
const test = require("node:test");
const assert = require("node:assert/strict");

const { assertDatesUnlocked, lockedDateChanges, datesAreLocked } = require("../src/lib/projectDateLock");

// A stored row the way node-postgres returns it: DATE columns are Dates at local midnight.
function row(status) {
  return {
    status,
    startdate: new Date(2027, 0, 4),
    constructionstartdate: new Date(2027, 1, 1),
    enddate: new Date(2027, 5, 30),
  };
}

const SAME = { startDate: "2027-01-04", constructionStartDate: "2027-02-01", endDate: "2027-06-30" };

test("lock: only Draft projects can still move the locked dates", () => {
  assert.equal(datesAreLocked("Draft"), false);
  assert.equal(datesAreLocked("Active"), true);
});

test("lock: a Draft project may change every date", () => {
  assert.deepEqual(
    lockedDateChanges(row("Draft"), { startDate: "2027-01-10", constructionStartDate: "2027-02-15", endDate: "2027-07-01" }),
    []
  );
});

test("lock: an Active project saving the same dates is fine (the form always sends all three)", () => {
  assert.doesNotThrow(() => assertDatesUnlocked(row("Active"), SAME));
});

test("lock: an Active project may still move the completion date", () => {
  assert.doesNotThrow(() => assertDatesUnlocked(row("Active"), { ...SAME, endDate: "2027-08-31" }));
});

test("lock: an Active project can't change the target date of development", () => {
  assert.throws(
    () => assertDatesUnlocked(row("Active"), { ...SAME, startDate: "2027-01-05" }),
    (err) => err.status === 409 && /development is locked/.test(err.message) && err.details.fieldErrors[0].field === "startDate"
  );
});

test("lock: an Active project can't change the target date of construction", () => {
  assert.throws(
    () => assertDatesUnlocked(row("Active"), { ...SAME, constructionStartDate: "2027-02-02" }),
    (err) => err.status === 409 && /construction is locked/.test(err.message) && err.details.fieldErrors[0].field === "constructionStartDate"
  );
});

test("lock: changing both locked dates reports both", () => {
  const changes = lockedDateChanges(row("Active"), { ...SAME, startDate: "2027-01-05", constructionStartDate: "2027-02-02" });
  assert.deepEqual(changes.map((c) => c.field), ["startDate", "constructionStartDate"]);
});

test("lock: dates stored as plain strings compare by calendar day", () => {
  const stored = { status: "Active", startdate: "2027-01-04", constructionstartdate: "2027-02-01T00:00:00.000Z", enddate: "2027-06-30" };
  assert.deepEqual(lockedDateChanges(stored, SAME), []);
});
