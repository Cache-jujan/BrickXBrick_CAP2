// managerChangeNotice.js (F2): tell a Project Manager or Site Manager that a project
// was handed to someone else. The new manager is told inside the reassignment
// (ProjectAssigned); the one taken off is told here, after the change is saved.
//
// Never throws: a notice that can't be written (for example before migration 067
// is run) must not undo or block the reassignment.

function removedMessage(project, role, newManagerName) {
  const to = newManagerName ? ` It was reassigned to ${newManagerName}.` : "";
  return `You are no longer the ${role} of "${project.name}".${to}`;
}

/**
 * previousId: who held the role before. newId: who holds it now. Nothing is sent
 * when there was nobody before or nothing changed. Returns true when sent.
 */
async function notifyRemovedManager(runQuery, { previousId, newId, role, project, newManagerName = null }, log = console) {
  if (!previousId || previousId === newId) return false;
  try {
    await runQuery(
      `INSERT INTO notifications (recipientId, type, relatedEntityType, relatedEntityId, message)
       VALUES ($1, 'ProjectUnassigned', 'Project', $2, $3)`,
      [previousId, project.projectid, removedMessage(project, role, newManagerName)]
    );
    return true;
  } catch (err) {
    log.error(`${role} changed, but the previous one could not be notified:`, err.message);
    return false;
  }
}

module.exports = { notifyRemovedManager, removedMessage };
