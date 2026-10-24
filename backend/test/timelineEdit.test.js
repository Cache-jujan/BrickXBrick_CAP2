// F3 "Edit timeline" (timelineEdit.js): parsing the request, deciding what can
// be saved, and applying it. No database: planTimelineChanges is pure, and
// applyTimelineChanges runs against a small in-memory fake of the SQL it issues
// (matched on fixed query prefixes — update the matchers if those queries change).
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseTimelineChanges,
  planTimelineChanges,
  applyTimelineChanges,
  loadTimelineLocks,
} = require("../src/lib/timelineEdit");

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// A date far in the future, so no milestone is At Risk or Overdue and
// recalcMilestoneProgress never writes a notification in these tests.
const FAR = "2099-06-30";

function baseCurrent(overrides = {}) {
  return {
    milestones: [
      { milestoneid: M1, name: "Foundation", duedate: FAR, phase: "Construction" },
      { milestoneid: M2, name: "Permits", duedate: FAR, phase: "Planning" },
    ],
    tasks: [
      { taskid: T1, milestoneid: M1, taskname: "Excavate", duedate: FAR, status: "Pending" },
      { taskid: T2, milestoneid: M1, taskname: "Pour footings", duedate: FAR, status: "Completed" },
      { taskid: T3, milestoneid: M2, taskname: "File application", duedate: FAR, status: "Pending" },
    ],
    locks: new Map(),
    ...overrides,
  };
}

const plan = (changes, current = baseCurrent()) =>
  planTimelineChanges(current, parseTimelineChanges(changes));

// ── parseTimelineChanges ─────────────────────────────────────────────────────

test("parse: trims names and keeps only the fields that were sent", () => {
  const out = parseTimelineChanges({
    milestones: [{ milestoneID: M1, name: "  New name  " }],
    tasks: [{ taskID: T1, dueDate: "2026-12-01" }],
  });
  assert.deepEqual(out.milestones, [{ id: M1, remove: false, name: "New name" }]);
  assert.deepEqual(out.tasks, [{ id: T1, remove: false, dueDate: "2026-12-01" }]);
});

test("parse: remove wins and drops the other fields", () => {
  const out = parseTimelineChanges({ tasks: [{ taskID: T1, remove: true, taskName: "ignored" }] });
  assert.deepEqual(out.tasks, [{ id: T1, remove: true }]);
});

test("parse: rejects bad input with a 400", () => {
  const bad = [
    {},
    { milestones: "x" },
    { milestones: [{ milestoneID: "not-a-uuid", name: "x" }] },
    { milestones: [{ milestoneID: M1, name: "   " }] },
    { milestones: [{ milestoneID: M1, name: "x".repeat(151) }] },
    { milestones: [{ milestoneID: M1, dueDate: "2026-02-30" }] },
    { milestones: [{ milestoneID: M1, dueDate: "12/01/2026" }] },
    { milestones: [{ milestoneID: M1, remove: "yes" }] },
    { milestones: [{ milestoneID: M1, name: "a" }, { milestoneID: M1, name: "b" }] },
    { tasks: [{ taskID: T1 }] }, // entry with no change at all
    null,
  ];
  for (const body of bad) {
    assert.throws(() => parseTimelineChanges(body), (e) => e.status === 400, JSON.stringify(body));
  }
});

// ── planTimelineChanges ──────────────────────────────────────────────────────

test("plan: a rename and a new due date become updates", () => {
  const p = plan({
    milestones: [{ milestoneID: M1, name: "Foundations", dueDate: "2099-07-15" }],
    tasks: [{ taskID: T1, taskName: "Excavate site" }],
  });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.milestoneUpdates, [{ milestoneId: M1, name: "Foundations", dueDate: "2099-07-15" }]);
  assert.equal(p.taskUpdates.length, 1);
  assert.equal(p.taskUpdates[0].name, "Excavate site");
  assert.equal(p.taskUpdates[0].dueDate, null);
});

test("plan: values equal to the current ones are not changes", () => {
  const p = plan({ milestones: [{ milestoneID: M1, name: "Foundation", dueDate: FAR }] });
  assert.deepEqual(p.milestoneUpdates, []);
  assert.deepEqual(p.touchedMilestoneIds, []);
});

test("plan: a Date from the database compares by its calendar day", () => {
  const current = baseCurrent();
  current.milestones[0].duedate = new Date(2099, 5, 30); // local midnight, as node-postgres returns
  const p = plan({ milestones: [{ milestoneID: M1, dueDate: "2099-06-30" }] }, current);
  assert.deepEqual(p.milestoneUpdates, []);
});

test("plan: only a new milestone due date asks for a recalculation", () => {
  const renameOnly = plan({ milestones: [{ milestoneID: M1, name: "Renamed" }] });
  assert.deepEqual(renameOnly.touchedMilestoneIds, []);
  const redated = plan({ milestones: [{ milestoneID: M1, dueDate: "2099-08-01" }] });
  assert.deepEqual(redated.touchedMilestoneIds, [M1]);
});

test("plan: a completed task cannot be renamed, re-dated or deleted", () => {
  for (const change of [{ taskName: "x" }, { dueDate: "2099-08-01" }, { remove: true }]) {
    const p = plan({ tasks: [{ taskID: T2, ...change }] });
    assert.equal(p.errors.length, 1, JSON.stringify(change));
    assert.match(p.errors[0].message, /completed/);
    assert.deepEqual(p.taskUpdates, []);
    assert.deepEqual(p.taskDeletes, []);
  }
});

test("plan: a task with progress or documents can be edited but not deleted", () => {
  const current = baseCurrent({ locks: new Map([[T1, "progress"], [T3, "documents"]]) });

  const edit = plan({ tasks: [{ taskID: T1, taskName: "Excavate (rev)" }] }, current);
  assert.deepEqual(edit.errors, []);
  assert.equal(edit.taskUpdates.length, 1);

  const delProgress = plan({ tasks: [{ taskID: T1, remove: true }] }, current);
  assert.match(delProgress.errors[0].message, /progress submission/);
  const delDocs = plan({ tasks: [{ taskID: T3, remove: true }] }, current);
  assert.match(delDocs.errors[0].message, /documents attached/);
});

test("plan: deleting a milestone deletes its tasks", () => {
  const current = baseCurrent();
  current.tasks[1].status = "Pending"; // nothing completed under M1 now
  const p = plan({ milestones: [{ milestoneID: M1, remove: true }] }, current);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.milestoneDeletes, [M1]);
  assert.deepEqual([...p.taskDeletes].sort(), [T1, T2].sort());
  assert.deepEqual(p.touchedMilestoneIds, []);
});

test("plan: a milestone with a completed or locked task is kept, and the error names the task", () => {
  const completed = plan({ milestones: [{ milestoneID: M1, remove: true }] }); // T2 is Completed
  assert.equal(completed.errors.length, 1);
  assert.match(completed.errors[0].message, /"Foundation" can't be deleted/);
  assert.match(completed.errors[0].message, /Pour footings/);
  assert.deepEqual(completed.milestoneDeletes, []);
  assert.deepEqual(completed.taskDeletes, []);

  const current = baseCurrent({ locks: new Map([[T3, "documents"]]) });
  const locked = plan({ milestones: [{ milestoneID: M2, remove: true }] }, current);
  assert.match(locked.errors[0].message, /File application/);
});

test("plan: edits to a task whose milestone is being deleted are dropped, not errors", () => {
  const current = baseCurrent();
  current.tasks[1].status = "Pending";
  const p = plan(
    { milestones: [{ milestoneID: M1, remove: true }], tasks: [{ taskID: T1, taskName: "Renamed" }] },
    current
  );
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.taskUpdates, []);
});

test("plan: deleting a task asks its milestone for a recalculation", () => {
  const p = plan({ tasks: [{ taskID: T3, remove: true }] });
  assert.deepEqual(p.taskDeletes, [T3]);
  assert.deepEqual(p.touchedMilestoneIds, [M2]);
});

test("plan: ids that are not in this project are errors", () => {
  const stranger = "99999999-9999-4999-8999-999999999999";
  const p = plan({
    milestones: [{ milestoneID: stranger, name: "x" }],
    tasks: [{ taskID: stranger, remove: true }],
  });
  assert.equal(p.errors.length, 2);
  assert.match(p.errors[0].message, /not part of this project/);
});

// ── applyTimelineChanges (fake transaction client) ───────────────────────────

function makeFakeClient({ current = baseCurrent(), lockedTasks = [] } = {}) {
  const state = {
    milestones: current.milestones.map((m) => ({ ...m })),
    tasks: current.tasks.map((t) => ({ ...t })),
    writes: [],
    recalculated: [],
  };
  const client = {
    state,
    query: async (text, params = []) => {
      const sql = text.replace(/\s+/g, " ").trim();

      if (sql.startsWith("SELECT milestoneId, name, dueDate, phase FROM milestones")) {
        return { rows: state.milestones.map((m) => ({ ...m })), rowCount: state.milestones.length };
      }
      if (sql.startsWith("SELECT t.taskId, t.milestoneId, t.taskName, t.status, t.dueDate FROM tasks t")) {
        return { rows: state.tasks.map((t) => ({ ...t })), rowCount: state.tasks.length };
      }
      if (sql.startsWith("SELECT DISTINCT taskId FROM task_documents")) {
        const rows = lockedTasks.filter((l) => l.kind === "documents").map((l) => ({ taskid: l.id }));
        return { rows, rowCount: rows.length };
      }
      if (sql.startsWith("SELECT DISTINCT taskId FROM task_progress_log")) {
        const rows = lockedTasks.filter((l) => l.kind === "progress").map((l) => ({ taskid: l.id }));
        return { rows, rowCount: rows.length };
      }
      if (sql.startsWith("DELETE FROM tasks")) {
        const [ids] = params;
        state.tasks = state.tasks.filter((t) => !ids.includes(t.taskid));
        state.writes.push(["delete-tasks", ids]);
        return { rows: [], rowCount: ids.length };
      }
      if (sql.startsWith("DELETE FROM milestones")) {
        const [ids] = params;
        state.milestones = state.milestones.filter((m) => !ids.includes(m.milestoneid));
        state.writes.push(["delete-milestones", ids]);
        return { rows: [], rowCount: ids.length };
      }
      if (sql.startsWith("UPDATE milestones SET name")) {
        const [id, name, dueDate] = params;
        state.writes.push(["update-milestone", id, name, dueDate]);
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE tasks SET taskName")) {
        const [id, name, dueDate] = params;
        state.writes.push(["update-task", id, name, dueDate]);
        // The alert flag is reset only when a new due date is being set.
        assert.match(sql, /scheduleVarianceAlertSent = CASE WHEN \$3::date IS NOT NULL THEN FALSE/);
        return { rows: [], rowCount: 1 };
      }

      // recalcMilestoneProgress
      if (sql.startsWith("SELECT completionPercentage FROM tasks WHERE milestoneId")) {
        const [id] = params;
        state.recalculated.push(id);
        const rows = state.tasks
          .filter((t) => t.milestoneid === id)
          .map((t) => ({ completionpercentage: t.status === "Completed" ? 100 : 0 }));
        return { rows, rowCount: rows.length };
      }
      if (sql.startsWith("SELECT milestoneId, projectId, name, dueDate, status FROM milestones")) {
        const [id] = params;
        const m = state.milestones.find((x) => x.milestoneid === id);
        return { rows: [{ ...m, projectid: "p1", status: "On Track" }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE milestones SET completionPercentage")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unhandled query in fake client: ${sql}`);
    },
  };
  return client;
}

const PROJECT = {
  projectid: "p1",
  startdate: "2099-01-01",
  constructionstartdate: "2099-03-01",
  enddate: "2099-09-30",
};

test("apply: saves updates and deletes, recalculates only the touched milestones", async () => {
  const client = makeFakeClient();
  const changes = parseTimelineChanges({
    milestones: [{ milestoneID: M1, dueDate: "2099-07-15" }],
    tasks: [{ taskID: T3, remove: true }, { taskID: T1, taskName: "Excavate site" }],
  });

  const result = await applyTimelineChanges(client, PROJECT, changes);

  assert.deepEqual(
    { ...result, warnings: undefined },
    { updatedMilestones: 1, updatedTasks: 1, deletedMilestones: 0, deletedTasks: 1, warnings: undefined }
  );
  assert.deepEqual(client.state.writes[0], ["delete-tasks", [T3]]); // deletes come first
  assert.deepEqual([...client.state.recalculated].sort(), [M1, M2].sort());
});

test("apply: deletes tasks before the milestone that owns them", async () => {
  const current = baseCurrent();
  current.tasks[1].status = "Pending";
  const client = makeFakeClient({ current });
  const changes = parseTimelineChanges({ milestones: [{ milestoneID: M1, remove: true }] });

  await applyTimelineChanges(client, PROJECT, changes);

  assert.equal(client.state.writes[0][0], "delete-tasks");
  assert.equal(client.state.writes[1][0], "delete-milestones");
  assert.equal(client.state.milestones.length, 1);
  assert.deepEqual(client.state.recalculated, []);
});

test("apply: any problem means a 409 with the list and nothing is written", async () => {
  const client = makeFakeClient({ lockedTasks: [{ id: T3, kind: "documents" }] });
  const changes = parseTimelineChanges({
    milestones: [{ milestoneID: M1, name: "Would have been saved" }],
    tasks: [{ taskID: T3, remove: true }, { taskID: T2, taskName: "locked" }],
  });

  await assert.rejects(
    applyTimelineChanges(client, PROJECT, changes),
    (e) => {
      assert.equal(e.status, 409);
      assert.equal(e.details.errors.length, 2);
      assert.match(e.message, /Nothing was saved/);
      return true;
    }
  );
  assert.deepEqual(client.state.writes, []);
});

test("apply: a date outside the phase window is saved with a warning that names the item", async () => {
  const client = makeFakeClient();
  const changes = parseTimelineChanges({ milestones: [{ milestoneID: M1, dueDate: "2099-12-31" }] });

  const result = await applyTimelineChanges(client, PROJECT, changes);

  assert.equal(result.updatedMilestones, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /^Foundation: /);
  assert.match(result.warnings[0], /Target Date of Completion/);
});

test("apply: renaming a task alone triggers no recalculation and no warning", async () => {
  const client = makeFakeClient();
  const changes = parseTimelineChanges({ tasks: [{ taskID: T1, taskName: "Excavate site" }] });

  const result = await applyTimelineChanges(client, PROJECT, changes);

  assert.deepEqual(client.state.recalculated, []);
  assert.deepEqual(result.warnings, []);
});

// ── loadTimelineLocks ────────────────────────────────────────────────────────

test("locks: progress outranks documents, and tasks with neither are absent", async () => {
  const run = async (sql) => {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text.startsWith("SELECT t.taskId FROM tasks t")) return { rows: [{ taskid: T1 }, { taskid: T2 }, { taskid: T3 }] };
    if (text.startsWith("SELECT DISTINCT taskId FROM task_documents")) return { rows: [{ taskid: T1 }, { taskid: T3 }] };
    if (text.startsWith("SELECT DISTINCT taskId FROM task_progress_log")) return { rows: [{ taskid: T1 }] };
    throw new Error("unexpected: " + text);
  };
  assert.deepEqual(await loadTimelineLocks(run, "p1"), { [T1]: "progress", [T3]: "documents" });
});