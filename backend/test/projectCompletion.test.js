// Unit tests for lib/projectCompletion.js: open items before completing, and the completion notices.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  findOpenItems, completionRecipients, completionMessage, notifyProjectCompleted, OPEN_TICKET_STATUSES,
} = require("../src/lib/projectCompletion");

function fakeDb({ tickets = 0, expenses = 0, purchasers = [], failInsert = false } = {}) {
  const calls = [];
  async function run(sql, params = []) {
    calls.push({ sql, params });
    if (/FROM tickets/.test(sql)) return { rows: [{ n: tickets }] };
    if (/FROM expenses/.test(sql)) return { rows: [{ n: expenses }] };
    if (/FROM users/.test(sql)) return { rows: purchasers.map((userid) => ({ userid })) };
    if (/INSERT INTO notifications/.test(sql)) {
      if (failInsert) throw new Error('violates check constraint "notifications_type_check"');
      return { rowCount: 1 };
    }
    throw new Error(`unexpected query: ${sql}`);
  }
  return { run, calls };
}

const project = { projectid: "p1", name: "Tibon Residence", projectmanagerid: "pm1", sitemanagerid: "sm1" };
const quiet = { error() {} };

test("findOpenItems counts open requests and Pending expenses of the project", async () => {
  const db = fakeDb({ tickets: 2, expenses: 3 });
  assert.deepEqual(await findOpenItems(db.run, "p1"), { openTickets: 2, pendingExpenses: 3 });
  assert.deepEqual(db.calls[0].params, ["p1", OPEN_TICKET_STATUSES]);
  assert.deepEqual(db.calls[1].params, ["p1"]);
});

test("findOpenItems is zero when nothing is open", async () => {
  assert.deepEqual(await findOpenItems(fakeDb().run, "p1"), { openTickets: 0, pendingExpenses: 0 });
});

test("open requests are Pending and Acknowledged only", () => {
  assert.deepEqual(OPEN_TICKET_STATUSES, ["Pending", "Acknowledged"]);
});

test("recipients are the PM, the SM and every active Purchaser, once each", async () => {
  const db = fakeDb({ purchasers: ["pu1", "pu2", "pm1"] });
  assert.deepEqual(await completionRecipients(db.run, project), ["pm1", "sm1", "pu1", "pu2"]);
});

test("a project without a Site Manager notifies no blank recipient", async () => {
  const db = fakeDb({ purchasers: [] });
  assert.deepEqual(await completionRecipients(db.run, { ...project, sitemanagerid: null }), ["pm1"]);
});

test("the message names the project and the turnover date", () => {
  assert.match(completionMessage(project, "2027-05-31"), /"Tibon Residence" is completed \(turned over on 2027-05-31\)/);
});

test("notifyProjectCompleted writes one ProjectCompleted notice per recipient", async () => {
  const db = fakeDb({ purchasers: ["pu1"] });
  assert.equal(await notifyProjectCompleted(db.run, project, "2027-05-31", quiet), 3);
  const inserts = db.calls.filter((c) => /INSERT INTO notifications/.test(c.sql));
  assert.equal(inserts.length, 3);
  assert.ok(inserts.every((c) => /'ProjectCompleted'/.test(c.sql) && c.params[1] === "p1"));
});

test("a failed notice (e.g. migration 067 not run) is logged, never thrown", async () => {
  const logged = [];
  const db = fakeDb({ purchasers: ["pu1"], failInsert: true });
  const sent = await notifyProjectCompleted(db.run, project, "2027-05-31", { error: (...a) => logged.push(a) });
  assert.equal(sent, 0);
  assert.equal(logged.length, 1);
});
