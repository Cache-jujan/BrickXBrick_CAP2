// Regression tests for:
//   D-01 — a milestone that goes past due with no task activity stayed
//          "On Track" forever because status was only ever recomputed on
//          task-create or PM Acknowledge, never on the passage of time.
//   D-08 — an overdue task under an on-track milestone never alerted,
//          because only milestone-level dates were ever evaluated.
//   D-10 — the schedule-variance alert text omitted the milestone name,
//          making multiple alerts on one project indistinguishable.
//
// sweepScheduleVariance/recalcMilestoneProgress take an injectable `client`
// (same shape pg's pool.query/transaction client exposes), so these run
// against an in-memory fake instead of a live Postgres instance.
const test = require("node:test");
const assert = require("node:assert/strict");

const { recalcMilestoneProgress, sweepScheduleVariance } = require("../src/lib/milestoneProgress");

function daysFromNow(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

// Minimal in-memory stand-in for the subset of SQL milestoneProgress.js
// issues. Matches on the fixed query prefixes in src/lib/milestoneProgress.js
// — if that file's queries change shape, these matchers need updating too.
function makeFakeDb({ milestones = [], tasks = [], projects = [] }) {
  const state = {
    milestones: milestones.map((m) => ({ ...m })),
    tasks: tasks.map((t) => ({ ...t })),
    projects: projects.map((p) => ({ ...p })),
    notifications: [],
  };

  const client = {
    state,
    query: async (text, params = []) => {
      const sql = text.replace(/\s+/g, " ").trim();

      if (sql.startsWith("SELECT completionPercentage FROM tasks WHERE milestoneId")) {
        const [milestoneId] = params;
        const rows = state.tasks
          .filter((t) => t.milestoneid === milestoneId)
          .map((t) => ({ completionpercentage: t.completionpercentage }));
        return { rows, rowCount: rows.length };
      }

      if (sql.startsWith("SELECT milestoneId, projectId, name, dueDate, status FROM milestones")) {
        const [milestoneId] = params;
        const m = state.milestones.find((m) => m.milestoneid === milestoneId);
        return m ? { rows: [{ ...m }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("UPDATE milestones")) {
        const [completionPercentage, newStatus, milestoneId] = params;
        const m = state.milestones.find((m) => m.milestoneid === milestoneId);
        if (m) {
          m.completionpercentage = completionPercentage;
          if (newStatus === "Completed" && !m.completedat) m.completedat = new Date();
          else if (newStatus !== "Completed") m.completedat = null;
          m.status = newStatus;
        }
        return { rows: [], rowCount: 1 };
      }

      if (sql.startsWith("SELECT projectManagerId, name FROM projects")) {
        const [projectId] = params;
        const p = state.projects.find((p) => p.projectid === projectId);
        return p ? { rows: [{ ...p }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("INSERT INTO notifications") && sql.includes("'Milestone'")) {
        const [recipientId, relatedEntityId, message] = params;
        state.notifications.push({ recipientid: recipientId, relatedentitytype: "Milestone", relatedentityid: relatedEntityId, message });
        return { rows: [], rowCount: 1 };
      }

      if (sql.startsWith("SELECT milestoneId FROM milestones WHERE status")) {
        const rows = state.milestones
          .filter((m) => m.status !== "Completed")
          .map((m) => ({ milestoneid: m.milestoneid }));
        return { rows, rowCount: rows.length };
      }

      if (sql.startsWith("SELECT t.taskId, t.taskName, t.dueDate")) {
        const today = daysFromNow(0);
        const rows = state.tasks
          .filter((t) => t.status !== "Completed" && !t.schedulevariancealertsent && new Date(t.duedate) < today)
          .map((t) => {
            const milestone = state.milestones.find((m) => m.milestoneid === t.milestoneid);
            const project = state.projects.find((p) => p.projectid === milestone.projectid);
            return {
              taskid: t.taskid,
              taskname: t.taskname,
              duedate: t.duedate,
              projectmanagerid: project.projectmanagerid,
              projectname: project.name,
            };
          });
        return { rows, rowCount: rows.length };
      }

      if (sql.startsWith("INSERT INTO notifications") && sql.includes("'Task'")) {
        const [recipientId, relatedEntityId, message] = params;
        state.notifications.push({ recipientid: recipientId, relatedentitytype: "Task", relatedentityid: relatedEntityId, message });
        return { rows: [], rowCount: 1 };
      }

      if (sql.startsWith("UPDATE tasks SET scheduleVarianceAlertSent")) {
        const [taskId] = params;
        const t = state.tasks.find((t) => t.taskid === taskId);
        if (t) t.schedulevariancealertsent = true;
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unhandled query in fake client: ${sql}`);
    },
  };

  return client;
}

test("D-01: a milestone whose due date passed with no task activity flips to Overdue and alerts (S-05)", async () => {
  const client = makeFakeDb({
    projects: [{ projectid: "proj-1", projectmanagerid: "pm-1", name: "Alpha" }],
    milestones: [{ milestoneid: "m-1", projectid: "proj-1", name: "Foundation", duedate: daysFromNow(-1), status: "On Track", completedat: null }],
    tasks: [{ taskid: "t-1", milestoneid: "m-1", completionpercentage: 0 }],
  });

  await sweepScheduleVariance(client);

  const milestone = client.state.milestones[0];
  assert.equal(milestone.status, "Overdue");
  assert.equal(client.state.notifications.length, 1);
  assert.equal(client.state.notifications[0].relatedentitytype, "Milestone");
  assert.equal(client.state.notifications[0].recipientid, "pm-1");
});

test("D-10: the milestone alert message includes the milestone name, not just the project (S-09/W-09)", async () => {
  const client = makeFakeDb({
    projects: [{ projectid: "proj-1", projectmanagerid: "pm-1", name: "Alpha" }],
    milestones: [{ milestoneid: "m-1", projectid: "proj-1", name: "Foundation", duedate: daysFromNow(-1), status: "On Track", completedat: null }],
    tasks: [],
  });

  await recalcMilestoneProgress(client, "m-1");

  const [notification] = client.state.notifications;
  assert.match(notification.message, /Foundation/);
  assert.match(notification.message, /Alpha/);
});

test("D-01: re-sweeping an already-Overdue milestone does not duplicate the alert (no spam on repeat sweeps)", async () => {
  const client = makeFakeDb({
    projects: [{ projectid: "proj-1", projectmanagerid: "pm-1", name: "Alpha" }],
    milestones: [{ milestoneid: "m-1", projectid: "proj-1", name: "Foundation", duedate: daysFromNow(-1), status: "On Track", completedat: null }],
    tasks: [],
  });

  await sweepScheduleVariance(client);
  await sweepScheduleVariance(client);

  assert.equal(client.state.notifications.length, 1);
});

test("D-08: an overdue task under an on-track milestone alerts (UC-05-01 postcondition, S-12)", async () => {
  const client = makeFakeDb({
    projects: [{ projectid: "proj-1", projectmanagerid: "pm-1", name: "Alpha" }],
    milestones: [{ milestoneid: "m-1", projectid: "proj-1", name: "Foundation", duedate: daysFromNow(30), status: "On Track", completedat: null }],
    tasks: [
      { taskid: "t-overdue", milestoneid: "m-1", taskname: "Pour footings", duedate: daysFromNow(-3), status: "Pending", completionpercentage: 0, schedulevariancealertsent: false },
      { taskid: "t-on-time", milestoneid: "m-1", taskname: "Set rebar", duedate: daysFromNow(5), status: "Pending", completionpercentage: 0, schedulevariancealertsent: false },
    ],
  });

  await sweepScheduleVariance(client);

  // Milestone itself stays On Track — it's 30 days out — but the overdue
  // task alerts independently.
  assert.equal(client.state.milestones[0].status, "On Track");

  const taskAlerts = client.state.notifications.filter((n) => n.relatedentitytype === "Task");
  assert.equal(taskAlerts.length, 1);
  assert.equal(taskAlerts[0].relatedentityid, "t-overdue");
  assert.match(taskAlerts[0].message, /Pour footings/);

  assert.equal(client.state.tasks.find((t) => t.taskid === "t-overdue").schedulevariancealertsent, true);
  assert.equal(client.state.tasks.find((t) => t.taskid === "t-on-time").schedulevariancealertsent, false);
});

test("D-08: an already-alerted overdue task is not alerted again on the next sweep", async () => {
  const client = makeFakeDb({
    projects: [{ projectid: "proj-1", projectmanagerid: "pm-1", name: "Alpha" }],
    milestones: [{ milestoneid: "m-1", projectid: "proj-1", name: "Foundation", duedate: daysFromNow(30), status: "On Track", completedat: null }],
    tasks: [
      { taskid: "t-overdue", milestoneid: "m-1", taskname: "Pour footings", duedate: daysFromNow(-3), status: "Pending", completionpercentage: 0, schedulevariancealertsent: false },
    ],
  });

  await sweepScheduleVariance(client);
  await sweepScheduleVariance(client);

  const taskAlerts = client.state.notifications.filter((n) => n.relatedentitytype === "Task");
  assert.equal(taskAlerts.length, 1);
});

test("D-08: a Completed overdue task is never alerted", async () => {
  const client = makeFakeDb({
    projects: [{ projectid: "proj-1", projectmanagerid: "pm-1", name: "Alpha" }],
    milestones: [{ milestoneid: "m-1", projectid: "proj-1", name: "Foundation", duedate: daysFromNow(30), status: "On Track", completedat: null }],
    tasks: [
      { taskid: "t-done", milestoneid: "m-1", taskname: "Pour footings", duedate: daysFromNow(-3), status: "Completed", completionpercentage: 100, schedulevariancealertsent: false },
    ],
  });

  await sweepScheduleVariance(client);

  assert.equal(client.state.notifications.length, 0);
});
