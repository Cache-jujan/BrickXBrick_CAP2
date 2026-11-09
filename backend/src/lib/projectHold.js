// projectHold.js — a Suspended project takes no new work.
//
// Requests, purchases, check-ins and offline syncs already need an Active
// project, so a hold stops them. Task progress had no project check, so this is
// the one extra gate (online route; the offline sync already requires Active).

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

module.exports = { assertProjectNotOnHold };
