// Regression tests for D-02: reassigning a project's Site Manager updated
// projects.siteManagerId only, so the outgoing SM kept backend access to
// open tasks (R-01) and the incoming SM got 403 on them (R-02), and
// clearing the SM entirely left the outgoing SM with access forever (R-03,
// since tasks.assignedTo is NOT NULL and so can never be cleared with it).
const test = require("node:test");
const assert = require("node:assert/strict");

const { reassignSiteManager } = require("../src/lib/reassignSiteManager");

// Fake transaction client: records every query issued so assertions can
// check not just outcomes but *which* statements ran (e.g. "no UPDATE was
// issued when there was nothing to move").
function makeFakeClient({ openTaskCount }) {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      const sql = text.replace(/\s+/g, " ").trim();
      calls.push({ sql, params });

      if (sql.startsWith("SELECT COUNT(*)::int AS count")) {
        return { rows: [{ count: openTaskCount }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE tasks t")) {
        return { rows: [], rowCount: openTaskCount };
      }
      throw new Error(`Unhandled query in fake client: ${sql}`);
    },
  };
}

test("reassigning to a new SM moves every open task to them (R-01, R-02)", async () => {
  const client = makeFakeClient({ openTaskCount: 3 });

  const result = await reassignSiteManager(client, { projectId: "project-beta", siteManagerId: "sm-1" });

  assert.equal(result.openTaskCount, 3);
  const moveCall = client.calls.find((c) => c.sql.startsWith("UPDATE tasks t"));
  assert.ok(moveCall, "expected an UPDATE tasks query moving open tasks");
  assert.deepEqual(moveCall.params, ["sm-1", "project-beta"]);
  assert.match(moveCall.sql, /t\.status <> 'Completed'/);
});

test("reassigning with no open tasks issues no task-move query", async () => {
  const client = makeFakeClient({ openTaskCount: 0 });

  await reassignSiteManager(client, { projectId: "project-gamma", siteManagerId: "sm-2" });

  assert.equal(client.calls.length, 1, "only the open-task count query should run");
  assert.ok(!client.calls.some((c) => c.sql.startsWith("UPDATE tasks t")));
});

test("clearing the SM while open tasks exist is rejected with 409 (R-03 gap)", async () => {
  const client = makeFakeClient({ openTaskCount: 2 });

  await assert.rejects(
    () => reassignSiteManager(client, { projectId: "project-beta", siteManagerId: null }),
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /2 open task/);
      return true;
    }
  );

  // Nothing beyond the count check should have run — the clear never
  // reaches a point where it could silently leave the old SM with access.
  assert.equal(client.calls.length, 1);
});

test("clearing the SM is allowed once no open tasks remain", async () => {
  const client = makeFakeClient({ openTaskCount: 0 });

  const result = await reassignSiteManager(client, { projectId: "project-delta", siteManagerId: null });

  assert.equal(result.openTaskCount, 0);
  assert.ok(!client.calls.some((c) => c.sql.startsWith("UPDATE tasks t")));
});
