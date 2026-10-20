// Site Manager home: deadline labels, the 7-day archive and project summaries.
import test from "node:test";
import assert from "node:assert/strict";

const { dueLabel, daysUntil, splitTasks, projectSummaries } = await import("../../sm-dashboard.js");

const NOW = new Date(2026, 9, 21, 9, 30); // 21 Oct 2026, 9:30 local

test("deadline labels count calendar days", () => {
  assert.equal(dueLabel("2026-10-21", NOW).text, "Due today");
  assert.equal(dueLabel("2026-10-22", NOW).text, "Due tomorrow");
  assert.equal(dueLabel("2026-10-26", NOW).text, "Due in 5 days");
  assert.equal(dueLabel("2026-10-19", NOW).text, "Overdue by 2 days");
  assert.equal(dueLabel("2026-10-20", NOW).tone, "late");
  assert.equal(dueLabel(null, NOW).text, "No due date");
});

test("a server timestamp at local midnight reads as that day", () => {
  assert.equal(daysUntil(new Date(2026, 9, 21).toISOString(), NOW), 0);
});

test("completed tasks are archived after 7 days; open ones sort by due date", () => {
  const tasks = [
    { taskid: "late", status: "Pending", duedate: "2026-10-30" },
    { taskid: "soon", status: "Pending", duedate: "2026-10-22" },
    { taskid: "done2d", status: "Completed", duedate: "2026-10-18", lastupdatedat: new Date(2026, 9, 19).toISOString() },
    { taskid: "done9d", status: "Completed", duedate: "2026-10-10", completedat: new Date(2026, 9, 12).toISOString() },
  ];
  const { open, recent, archived } = splitTasks(tasks, NOW);
  assert.deepEqual(open.map((t) => t.taskid), ["soon", "late"]);
  assert.deepEqual(recent.map((t) => t.taskid), ["done2d"]);
  assert.deepEqual(archived.map((t) => t.taskid), ["done9d"]);
});

test("projects show open work and the nearest deadline, nearest project first", () => {
  const tasks = [
    { projectid: "A", projectname: "House", projectstartdate: "2026-09-01", projectenddate: "2026-12-31",
      taskname: "Gather stone", status: "Pending", duedate: "2026-10-25", milestonename: "Foundation", milestoneduedate: "2026-10-23" },
    { projectid: "A", projectname: "House", taskname: "Old", status: "Completed", duedate: "2026-10-01" },
    { projectid: "B", projectname: "Barber", taskname: "Floor", status: "Pending", duedate: "2026-10-21" },
  ];
  const [first, second] = projectSummaries(tasks, NOW);
  assert.equal(first.name, "Barber");
  assert.equal(first.next.days, 0);
  assert.equal(second.openCount, 1);
  assert.equal(second.next.label, "Foundation (milestone)");
  assert.equal(second.startDate, "2026-09-01");
});
