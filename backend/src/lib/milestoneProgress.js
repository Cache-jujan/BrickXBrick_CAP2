// milestoneProgress.js — F3: recompute a milestone's completion % from its
// tasks, derive its schedule status via a due-date proximity heuristic, and
// fire a ScheduleVarianceAlert notification the first time it crosses into
// At Risk/Overdue (not on every recalc — that would spam the PM).

const AT_RISK_WINDOW_DAYS = 3;

function deriveStatus(dueDate, completionPercentage) {
    if (completionPercentage >= 100) return "Completed";

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);

    const msPerDay = 24 * 60 * 60 * 1000;
    const daysUntilDue = Math.round((due - today) / msPerDay);

    if (daysUntilDue < 0) return "Overdue";
    if (daysUntilDue <= AT_RISK_WINDOW_DAYS) return "At Risk";
    return "On Track";
}

// `client` must expose .query(text, params) — pass the transaction client
// from withTransaction. Not designed to be called outside a transaction.
async function recalcMilestoneProgress(client, milestoneId) {
    const taskResult = await client.query(
        "SELECT completionPercentage FROM tasks WHERE milestoneId = $1",
        [milestoneId]
    );

    const tasks = taskResult.rows;
    const completionPercentage = tasks.length === 0
        ? 0
        : tasks.reduce((sum, t) => sum + Number(t.completionpercentage), 0) / tasks.length;

    const milestoneResult = await client.query(
        "SELECT milestoneId, projectId, dueDate, status FROM milestones WHERE milestoneId = $1",
        [milestoneId]
    );
    if (milestoneResult.rowCount === 0) {
        const err = new Error(`Milestone ${milestoneId} not found`);
        err.status = 404;
        throw err;
    }
    const milestone = milestoneResult.rows[0];

    const newStatus = deriveStatus(milestone.duedate, completionPercentage);
    const wasAtRisk = milestone.status === "At Risk" || milestone.status === "Overdue";
    const isNowAtRisk = newStatus === "At Risk" || newStatus === "Overdue";

    await client.query(
            `UPDATE milestones
                SET completionPercentage = $1,
                    status = $2::varchar,
                    completedAt = CASE
                        WHEN $2::varchar = 'Completed' AND completedAt IS NULL THEN NOW()
                        WHEN $2::varchar != 'Completed' THEN NULL
                        ELSE completedAt
                    END
            WHERE milestoneId = $3`,
        [completionPercentage, newStatus, milestoneId]
    );

    // Fire only on the transition INTO at-risk/overdue, not on every recalc.
    if (isNowAtRisk && !wasAtRisk) {
        const projectResult = await client.query(
            "SELECT projectManagerId, name FROM projects WHERE projectId = $1",
            [milestone.projectid]
        );
        const project = projectResult.rows[0];

        if (project) {
            await client.query(
                `INSERT INTO notifications (recipientId, type, relatedEntityType, relatedEntityId, message)
                 VALUES ($1, 'ScheduleVarianceAlert', 'Milestone', $2, $3)`,
                [
                    project.projectmanagerid,
                    milestoneId,
                    `Milestone on project "${project.name}" is now ${newStatus} — due ${new Date(milestone.duedate).toDateString()}.`,
                ]
            );
        }
    }

    return { completionPercentage, status: newStatus };
}

module.exports = { recalcMilestoneProgress, deriveStatus };