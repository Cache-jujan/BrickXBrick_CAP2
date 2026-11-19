const test = require("node:test");
const assert = require("node:assert/strict");
const { closeOpenTicketsForProject, AUTO_CANCEL_REASON } = require("../src/lib/projectClosure");

function fakeClient(openRows) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FOR UPDATE OF t/.test(sql)) return { rowCount: openRows.length, rows: openRows };
      return { rowCount: 1, rows: [] };
    },
  };
}

test("rejects each open ticket and logs one transition per ticket", async () => {
  const client = fakeClient([
    { ticketid: "t1", status: "Pending" },
    { ticketid: "t2", status: "Acknowledged" },
  ]);
  const closed = await closeOpenTicketsForProject(client, "p1", "gm1");
  assert.equal(closed, 2);

  const updates = client.calls.filter((c) => /UPDATE tickets/.test(c.sql));
  assert.deepEqual(updates.map((c) => c.params), [
    ["t1", "gm1", AUTO_CANCEL_REASON],
    ["t2", "gm1", AUTO_CANCEL_REASON],
  ]);
  const logs = client.calls.filter((c) => /ticket_status_transitions/.test(c.sql));
  assert.deepEqual(logs.map((c) => c.params), [
    ["t1", "Pending", "gm1"],
    ["t2", "Acknowledged", "gm1"],
  ]);
});

test("selects only Pending, or Acknowledged with nothing bought", async () => {
  const client = fakeClient([]);
  assert.equal(await closeOpenTicketsForProject(client, "p1", "gm1"), 0);
  const select = client.calls[0].sql;
  assert.match(select, /status = 'Pending'/);
  assert.match(select, /status = 'Acknowledged'/);
  assert.match(select, /NOT EXISTS[\s\S]*expenses[\s\S]*<> 'Rejected'/);
  assert.equal(client.calls.length, 1);
});
