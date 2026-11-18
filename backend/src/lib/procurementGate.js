// procurementGate.js: the "Receive all initial procurement on site" gate task.
//
// Every project carries one Site Manager task with this requirementCode on its first
// Construction milestone (migration 066, and the template copy). Until it is Completed
// (the SM's photo acknowledged by the PM) no OTHER Construction task takes progress.
// A project with no gate task (older, or no Site Manager when 066 ran) is not gated.

const GATE_CODE = "GATE-PROC-RECEIVED";

const GATE_BLOCKED_MESSAGE =
  "Site Manager must mark 'Receive all initial procurement on site' as done before Construction work can start.";

// Is submitting progress on this task blocked by an open gate? `taskId` is the task being worked on.
async function isBlockedByProcurementGate(query, taskId) {
  const result = await query(
    `SELECT m.phase, t.requirementCode,
            EXISTS (
              SELECT 1 FROM tasks g
                JOIN milestones gm ON gm.milestoneId = g.milestoneId
               WHERE gm.projectId = m.projectId
                 AND g.requirementCode = $2
                 AND g.status <> 'Completed') AS gateOpen
       FROM tasks t
       JOIN milestones m ON m.milestoneId = t.milestoneId
      WHERE t.taskId = $1`,
    [taskId, GATE_CODE]
  );
  const row = result.rows[0];
  if (!row) return false;
  return row.phase === "Construction" && row.requirementcode !== GATE_CODE && row.gateopen === true;
}

module.exports = { GATE_CODE, GATE_BLOCKED_MESSAGE, isBlockedByProcurementGate };
