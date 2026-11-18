// procurementGate.js: the "Receive all initial procurement on site" task, and the rule that
// keeps Construction work closed until Pre-construction is finished.
//
// Every project carries one Site Manager task with this requirementCode as the FIRST task of
// its first Construction milestone (migration 066, and the template copy). It is an ordinary
// task: it no longer blocks the other Construction tasks. What does block Construction is an
// unfinished Pre-construction (Planning) task: see isBlockedByPreconstruction.

const GATE_CODE = "GATE-PROC-RECEIVED";

const PRECONSTRUCTION_MESSAGE =
  "Construction tasks open once every Pre-construction task is done.";

// Is this a Construction task of a project that still has an open Pre-construction (Planning) task?
async function isBlockedByPreconstruction(query, taskId) {
  const result = await query(
    `SELECT m.phase,
            EXISTS (
              SELECT 1 FROM tasks pt
                JOIN milestones pm ON pm.milestoneId = pt.milestoneId
               WHERE pm.projectId = m.projectId
                 AND pm.phase = 'Planning'
                 AND pt.status <> 'Completed') AS preOpen
       FROM tasks t
       JOIN milestones m ON m.milestoneId = t.milestoneId
      WHERE t.taskId = $1`,
    [taskId]
  );
  const row = result.rows[0];
  if (!row) return false;
  return row.phase === "Construction" && row.preopen === true;
}

module.exports = { GATE_CODE, PRECONSTRUCTION_MESSAGE, isBlockedByPreconstruction };
