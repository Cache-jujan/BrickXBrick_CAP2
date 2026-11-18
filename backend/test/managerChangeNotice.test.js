// Unit tests for lib/managerChangeNotice.js: the manager taken off a project is told.
const test = require("node:test");
const assert = require("node:assert/strict");
const { notifyRemovedManager, removedMessage } = require("../src/lib/managerChangeNotice");

const project = { projectid: "p1", name: "Tibon Residence" };
const quiet = { error() {} };

function recorder({ fail = false } = {}) {
  const calls = [];
  async function run(sql, params) {
    calls.push({ sql, params });
    if (fail) throw new Error('violates check constraint "notifications_type_check"');
    return { rowCount: 1 };
  }
  return { run, calls };
}

test("the previous manager gets a ProjectUnassigned notice naming the new one", async () => {
  const db = recorder();
  const sent = await notifyRemovedManager(db.run, { previousId: "sm-old", newId: "sm-new", role: "Site Manager", project, newManagerName: "Ana" }, quiet);
  assert.equal(sent, true);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /'ProjectUnassigned'/);
  assert.deepEqual(db.calls[0].params, ["sm-old", "p1", 'You are no longer the Site Manager of "Tibon Residence". It was reassigned to Ana.']);
});

test("nothing is sent when there was no previous manager or nothing changed", async () => {
  const db = recorder();
  assert.equal(await notifyRemovedManager(db.run, { previousId: null, newId: "pm1", role: "Project Manager", project }, quiet), false);
  assert.equal(await notifyRemovedManager(db.run, { previousId: "pm1", newId: "pm1", role: "Project Manager", project }, quiet), false);
  assert.equal(db.calls.length, 0);
});

test("the message works without the new manager's name", () => {
  assert.equal(removedMessage(project, "Project Manager", null), 'You are no longer the Project Manager of "Tibon Residence".');
});

test("a failed notice (e.g. migration 067 not run) is logged, never thrown", async () => {
  const logged = [];
  const sent = await notifyRemovedManager(recorder({ fail: true }).run,
    { previousId: "pm-old", newId: "pm-new", role: "Project Manager", project }, { error: (...a) => logged.push(a) });
  assert.equal(sent, false);
  assert.equal(logged.length, 1);
});
