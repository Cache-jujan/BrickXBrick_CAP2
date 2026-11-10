const test = require("node:test");
const assert = require("node:assert/strict");
const { assertProjectNotTerminated } = require("../src/lib/projectHold");

const runner = (rows) => async () => ({ rowCount: rows.length, rows });

test("a terminated project is refused with 409 PROJECT_TERMINATED", async () => {
  await assert.rejects(
    () => assertProjectNotTerminated(runner([{ status: "Cancelled" }]), { projectId: "p1" }),
    (err) => err.status === 409 && err.code === "PROJECT_TERMINATED" && /terminated/.test(err.message)
  );
});

test("Active, Suspended, Draft and Completed projects are not blocked here", async () => {
  for (const status of ["Active", "Suspended", "Draft", "Completed", "Archived"]) {
    await assertProjectNotTerminated(runner([{ status }]), { milestoneId: "m1" });
  }
});

test("an unknown id or no reference passes (the route answers 404 itself)", async () => {
  await assertProjectNotTerminated(runner([]), { taskId: "t1" });
  await assertProjectNotTerminated(runner([]), {});
  await assertProjectNotTerminated(runner([]), null);
});

test("looks the project up from a project, milestone or task id", async () => {
  const seen = [];
  const spy = async (sql, params) => { seen.push([sql, params]); return { rowCount: 1, rows: [{ status: "Active" }] }; };
  await assertProjectNotTerminated(spy, { projectId: "p" });
  await assertProjectNotTerminated(spy, { milestoneId: "m" });
  await assertProjectNotTerminated(spy, { taskId: "t" });
  assert.deepEqual(seen.map(([, p]) => p), [["p"], ["m"], ["t"]]);
  assert.match(seen[0][0], /FROM projects/);
  assert.match(seen[1][0], /FROM milestones/);
  assert.match(seen[2][0], /FROM tasks/);
});
