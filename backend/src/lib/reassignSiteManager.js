// reassignSiteManager.js — D-02: tasks.assignedTo was copied at task-create
// time and never moved when a project's Site Manager changed, so the old SM
// kept backend access to open (non-Completed) tasks and the new SM got 403
// on them. This moves every open task to the new SM in the same transaction
// as the project update.
//
// tasks.assignedTo is NOT NULL, so clearing the SM (siteManagerId: null)
// while open tasks exist would silently leave them with the outgoing SM —
// that's rejected with 409 instead. Completed tasks keep their original
// assignee; the work and photo evidence really are theirs, and the PM
// review route doesn't key off current assignment anyway.
//
// `client` must expose .query(text, params) — pass the transaction client
// from withTransaction.

async function countOpenTasks(client, projectId) {
    const result = await client.query(
        `SELECT COUNT(*)::int AS count
           FROM tasks t
           JOIN milestones m ON m.milestoneId = t.milestoneId
          WHERE m.projectId = $1 AND t.status <> 'Completed'`,
        [projectId]
    );
    return result.rows[0].count;
}

async function reassignSiteManager(client, { projectId, siteManagerId }) {
    const openTaskCount = await countOpenTasks(client, projectId);

    if (!siteManagerId && openTaskCount > 0) {
        const err = new Error(
            `Cannot clear the Site Manager while ${openTaskCount} open task(s) are still assigned — reassign them to another Site Manager first`
        );
        err.status = 409;
        throw err;
    }

    if (siteManagerId && openTaskCount > 0) {
        await client.query(
            `UPDATE tasks t
                SET assignedTo = $1
              FROM milestones m
             WHERE m.milestoneId = t.milestoneId
               AND m.projectId = $2
               AND t.status <> 'Completed'`,
            [siteManagerId, projectId]
        );
    }

    return { openTaskCount };
}

module.exports = { reassignSiteManager, countOpenTasks };
