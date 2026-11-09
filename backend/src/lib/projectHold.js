// projectHold.js — a Suspended project takes no new work.
//
// Requests, purchases, check-ins and offline syncs already need an Active
// project, so a hold stops them. Task progress had no project check, so this is
// the one extra gate (online route; the offline sync already requires Active).
// A terminated (Cancelled) project is read-only: assertProjectNotTerminated.

/** Throws 409 PROJECT_SUSPENDED when the milestone's project is on hold. */
async function assertProjectNotOnHold(runQuery, milestoneId) {
  const held = await runQuery(
    `SELECT 1 FROM milestones m JOIN projects p ON p.projectId = m.projectId
      WHERE m.milestoneId = $1 AND p.status = 'Suspended'`,
    [milestoneId]
  );
  if (held && held.rowCount > 0) {
    const err = new Error("This project is on hold. Progress can be sent again once it resumes.");
    err.status = 409;
    err.code = "PROJECT_SUSPENDED";
    throw err;
  }
}

// Where to find the project from what a route has in hand.
const PROJECT_LOOKUPS = {
  projectId: "SELECT p.status FROM projects p WHERE p.projectId = $1",
  milestoneId: "SELECT p.status FROM milestones m JOIN projects p ON p.projectId = m.projectId WHERE m.milestoneId = $1",
  taskId: `SELECT p.status FROM tasks t JOIN milestones m ON m.milestoneId = t.milestoneId
             JOIN projects p ON p.projectId = m.projectId WHERE t.taskId = $1`,
};

/**
 * Throws 409 PROJECT_TERMINATED when the project was cancelled / terminated.
 * A terminated project is read-only: no progress, reviews, request handling
 * or expense approvals. `ref` is one of { projectId } | { milestoneId } | { taskId }.
 * An unknown id passes: the route's own lookup answers 404.
 */
async function assertProjectNotTerminated(runQuery, ref) {
  const key = Object.keys(PROJECT_LOOKUPS).find((k) => ref && ref[k]);
  if (!key) return;
  const found = await runQuery(PROJECT_LOOKUPS[key], [ref[key]]);
  if (found && found.rowCount > 0 && found.rows[0].status === "Cancelled") {
    const err = new Error("This project was terminated. It is read-only and takes no new work.");
    err.status = 409;
    err.code = "PROJECT_TERMINATED";
    throw err;
  }
}

module.exports = { assertProjectNotOnHold, assertProjectNotTerminated };
