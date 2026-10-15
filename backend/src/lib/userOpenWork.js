// userOpenWork.js — F1: what a user is still responsible for.
//
// Used before a System Administrator changes someone's role or deactivates
// them. If the person still manages an open project, has unfinished tasks, or
// has material requests waiting on them, the change would leave that work
// stuck (nobody else can act on it, and they no longer can). The admin is told
// what to reassign first. Past records are never touched: they point to the
// person's ID, so history stays correct either way.
const OPEN_PROJECT_STATUSES = ["Draft", "Active"];
const OPEN_TICKET_STATUSES = ["Pending", "Acknowledged"];
const NAMES_SHOWN = 3;

async function findOpenWork(runQuery, userId) {
  const projects = await runQuery(
    `SELECT name,
            CASE WHEN projectManagerId = $1 THEN 'Project Manager' ELSE 'Site Manager' END AS asrole
       FROM projects
      WHERE (projectManagerId = $1 OR siteManagerId = $1)
        AND status = ANY($2::text[])
      ORDER BY name`,
    [userId, OPEN_PROJECT_STATUSES]
  );
  const tasks = await runQuery(
    `SELECT COUNT(*)::int AS n
       FROM tasks t
       JOIN milestones m ON m.milestoneId = t.milestoneId
       JOIN projects p ON p.projectId = m.projectId
      WHERE t.assignedTo = $1
        AND t.status <> 'Completed'
        AND p.status = ANY($2::text[])`,
    [userId, OPEN_PROJECT_STATUSES]
  );
  const requests = await runQuery(
    `SELECT COUNT(*)::int AS n
       FROM tickets
      WHERE assignedTo = $1
        AND status = ANY($2::text[])`,
    [userId, OPEN_TICKET_STATUSES]
  );
  return {
    projects: projects.rows.map((r) => ({ name: r.name, role: r.asrole })),
    openTasks: tasks.rows[0]?.n || 0,
    openRequests: requests.rows[0]?.n || 0,
  };
}

function hasOpenWork(work) {
  return work.projects.length > 0 || work.openTasks > 0 || work.openRequests > 0;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// "Juan still manages 2 open projects (Mandaue Riverside, PickleHaus) and has
//  3 unfinished tasks. Reassign them first, then try again."
function describeOpenWork(name, work) {
  const parts = [];
  if (work.projects.length) {
    const shown = work.projects.slice(0, NAMES_SHOWN).map((p) => p.name);
    const more = work.projects.length - shown.length;
    parts.push(
      `still manages ${plural(work.projects.length, "open project", "open projects")} ` +
        `(${shown.join(", ")}${more > 0 ? `, +${more} more` : ""})`
    );
  }
  if (work.openTasks) parts.push(`has ${plural(work.openTasks, "unfinished task", "unfinished tasks")}`);
  if (work.openRequests) {
    parts.push(`has ${plural(work.openRequests, "material request", "material requests")} waiting on them`);
  }
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `${name} ${list}. Reassign them first, then try again.`;
}

module.exports = { findOpenWork, hasOpenWork, describeOpenWork };
