// timelineEdit.js — F3: the PM's "Edit timeline" changes, in one place.
//
// The PM can rename or re-date milestones and tasks, and delete them, from one
// modal. The modal sends every change in ONE request and this file applies them
// in ONE transaction: either all of it is saved or none of it is.
//
// Rules (the backend is the enforcement point; the modal only mirrors them):
//   - Only a Draft or Active project can be changed (the route checks that).
//   - A Completed task is locked: it cannot be renamed, re-dated or deleted.
//   - A task that has a progress submission (task_progress_log) or any attached
//     document (task_documents, including removed ones, which are kept as a
//     record) cannot be deleted. It can still be renamed or re-dated.
//   - Deleting a milestone deletes its tasks, so every one of those tasks must
//     be deletable. Otherwise the milestone stays.
//   - Dates outside the phase window are allowed, with a warning (same rule as
//     adding a milestone or task).
//
// Pure functions plus SQL against an injected `client` (the transaction client
// from withTransaction), so the tests run with a fake client and no database.

const { isUUID } = require("./uuid");
const { recalcMilestoneProgress } = require("./milestoneProgress");
const { dateWindowWarning } = require("./scheduleWindows");

const MAX_ITEMS = 500;
const NAME_MAX = 150;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function httpError(status, message, details) {
    const err = new Error(message);
    err.status = status;
    if (details) err.details = details;
    return err;
}

function isRealDate(value) {
    const match = DATE_RE.exec(value);
    if (!match) return false;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const d = new Date(Date.UTC(year, month - 1, day));
    return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

// node-postgres returns a DATE as a JS Date at the server's local midnight, so
// read the local calendar fields (toISOString would shift the day on a server
// in UTC+8). Same approach as projects.js.
function dateKey(value) {
    if (!value) return null;
    if (typeof value === "string") return value.slice(0, 10);
    const d = new Date(value);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// --- 1. read and validate the request body -----------------------------------

function parseEntry(raw, { idKey, nameKey, label, seen }) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw httpError(400, `Each ${label} change must be an object`);
    }
    const id = raw[idKey];
    if (!isUUID(id)) throw httpError(400, `${idKey} must be a valid id`);
    if (seen.has(id)) throw httpError(400, `${label} ${id} appears more than once`);
    seen.add(id);

    if (raw.remove !== undefined && typeof raw.remove !== "boolean") {
        throw httpError(400, "remove must be true or false");
    }
    if (raw.remove === true) return { id, remove: true };

    const entry = { id, remove: false };
    if (raw[nameKey] !== undefined) {
        const name = typeof raw[nameKey] === "string" ? raw[nameKey].trim() : "";
        if (!name) throw httpError(400, `A ${label} name cannot be empty`);
        if (name.length > NAME_MAX) throw httpError(400, `A ${label} name can be at most ${NAME_MAX} characters`);
        entry.name = name;
    }
    if (raw.dueDate !== undefined) {
        if (typeof raw.dueDate !== "string" || !isRealDate(raw.dueDate)) {
            throw httpError(400, `A ${label} due date must be a real date (YYYY-MM-DD)`);
        }
        entry.dueDate = raw.dueDate;
    }
    return entry;
}

// body: { milestones: [{ milestoneID, name?, dueDate?, remove? }],
//         tasks:      [{ taskID, taskName?, dueDate?, remove? }] }
// Returns { milestones: [{ id, remove, name?, dueDate? }], tasks: [...] }.
function parseTimelineChanges(body) {
    const milestonesRaw = body && body.milestones !== undefined ? body.milestones : [];
    const tasksRaw = body && body.tasks !== undefined ? body.tasks : [];
    if (!Array.isArray(milestonesRaw) || !Array.isArray(tasksRaw)) {
        throw httpError(400, "milestones and tasks must be arrays");
    }
    if (milestonesRaw.length + tasksRaw.length > MAX_ITEMS) {
        throw httpError(400, `At most ${MAX_ITEMS} changes can be saved at once`);
    }

    const seenMilestones = new Set();
    const seenTasks = new Set();
    const milestones = milestonesRaw.map((raw) =>
        parseEntry(raw, { idKey: "milestoneID", nameKey: "name", label: "milestone", seen: seenMilestones })
    );
    const tasks = tasksRaw.map((raw) =>
        parseEntry(raw, { idKey: "taskID", nameKey: "taskName", label: "task", seen: seenTasks })
    );

    const hasChange = (e) => e.remove || e.name !== undefined || e.dueDate !== undefined;
    if (!milestones.some(hasChange) && !tasks.some(hasChange)) {
        throw httpError(400, "There are no changes to save");
    }
    return { milestones, tasks };
}

// --- 2. which tasks cannot be deleted ----------------------------------------

// taskIds -> Map(taskId -> "progress" | "documents"). Both tables are checked
// for every id, with the removed documents included on purpose: the record of
// what was attached has to survive.
async function findTaskLocks(run, taskIds) {
    const locks = new Map();
    if (!taskIds.length) return locks;

    const documents = await run(
        "SELECT DISTINCT taskId FROM task_documents WHERE taskId = ANY($1::uuid[])",
        [taskIds]
    );
    for (const row of documents.rows) locks.set(row.taskid, "documents");

    // Progress wins when a task has both: it is the stronger reason.
    const progress = await run(
        "SELECT DISTINCT taskId FROM task_progress_log WHERE taskId = ANY($1::uuid[])",
        [taskIds]
    );
    for (const row of progress.rows) locks.set(row.taskid, "progress");

    return locks;
}

// For the modal: { [taskId]: "progress" | "documents" } for this project's tasks
// that cannot be deleted. `run` is (sql, params) => result, e.g. db.query.
async function loadTimelineLocks(run, projectId) {
    const tasks = await run(
        `SELECT t.taskId
           FROM tasks t
           JOIN milestones m ON m.milestoneId = t.milestoneId
          WHERE m.projectId = $1`,
        [projectId]
    );
    const locks = await findTaskLocks(run, tasks.rows.map((r) => r.taskid));
    return Object.fromEntries(locks);
}

// --- 3. decide what can be saved ---------------------------------------------

const LOCK_REASON = {
    progress: "has a progress submission",
    documents: "has documents attached",
};

// current: { milestones: [{ milestoneid, name, duedate, phase }],
//            tasks: [{ taskid, milestoneid, taskname, duedate, status }],
//            locks: Map(taskId -> reason) }
// changes: the output of parseTimelineChanges.
// Returns { errors, milestoneUpdates, taskUpdates, milestoneDeletes, taskDeletes,
//           touchedMilestoneIds }. Nothing is applied when errors is not empty.
function planTimelineChanges(current, changes) {
    const errors = [];
    const milestoneById = new Map(current.milestones.map((m) => [m.milestoneid, m]));
    const taskById = new Map(current.tasks.map((t) => [t.taskid, t]));
    const locks = current.locks || new Map();

    const milestoneUpdates = [];
    const taskUpdates = [];
    const milestoneDeletes = [];
    const taskDeletes = new Set();
    const touched = new Set();

    // Why a task cannot be deleted, or null when it can.
    function deleteBlocker(task) {
        if (task.status === "Completed") return "is completed";
        const lock = locks.get(task.taskid);
        return lock ? LOCK_REASON[lock] : null;
    }

    // Milestones first: a deleted milestone takes all of its tasks with it.
    const deletingMilestones = new Set();
    for (const entry of changes.milestones) {
        const milestone = milestoneById.get(entry.id);
        if (!milestone) {
            errors.push({ type: "milestone", id: entry.id, message: "This milestone is not part of this project." });
            continue;
        }
        if (!entry.remove) continue;

        const blockers = current.tasks
            .filter((t) => t.milestoneid === entry.id)
            .map((t) => ({ task: t, why: deleteBlocker(t) }))
            .filter((b) => b.why);
        if (blockers.length) {
            const first = blockers[0];
            const more = blockers.length > 1 ? ` (and ${blockers.length - 1} more)` : "";
            errors.push({
                type: "milestone",
                id: entry.id,
                message: `"${milestone.name}" can't be deleted: the task "${first.task.taskname}" ${first.why}${more}.`,
            });
            continue;
        }
        deletingMilestones.add(entry.id);
        milestoneDeletes.push(entry.id);
        for (const t of current.tasks) if (t.milestoneid === entry.id) taskDeletes.add(t.taskid);
    }

    for (const entry of changes.milestones) {
        if (entry.remove || !milestoneById.has(entry.id)) continue;
        const milestone = milestoneById.get(entry.id);
        const update = { milestoneId: entry.id, name: null, dueDate: null };
        if (entry.name !== undefined && entry.name !== milestone.name) update.name = entry.name;
        if (entry.dueDate !== undefined && entry.dueDate !== dateKey(milestone.duedate)) update.dueDate = entry.dueDate;
        if (update.name === null && update.dueDate === null) continue; // nothing actually changed
        milestoneUpdates.push(update);
        // Only a new due date can change the milestone's schedule status.
        if (update.dueDate !== null) touched.add(entry.id);
    }

    for (const entry of changes.tasks) {
        const task = taskById.get(entry.id);
        if (!task) {
            errors.push({ type: "task", id: entry.id, message: "This task is not part of this project." });
            continue;
        }
        // Already going away with its milestone: nothing more to do for it.
        if (deletingMilestones.has(task.milestoneid)) continue;

        if (entry.remove) {
            const why = deleteBlocker(task);
            if (why) {
                errors.push({ type: "task", id: entry.id, message: `The task "${task.taskname}" can't be deleted: it ${why}.` });
                continue;
            }
            taskDeletes.add(task.taskid);
            touched.add(task.milestoneid);
            continue;
        }

        const update = { taskId: entry.id, name: null, dueDate: null, milestoneId: task.milestoneid };
        if (entry.name !== undefined && entry.name !== task.taskname) update.name = entry.name;
        if (entry.dueDate !== undefined && entry.dueDate !== dateKey(task.duedate)) update.dueDate = entry.dueDate;
        if (update.name === null && update.dueDate === null) continue;
        if (task.status === "Completed") {
            errors.push({ type: "task", id: entry.id, message: `The task "${task.taskname}" is completed and can't be changed.` });
            continue;
        }
        // A rename or new due date does not change the milestone's progress
        // (that is completed tasks over total tasks), so no recalculation.
        taskUpdates.push(update);
    }

    // A milestone that is being deleted needs no recalculation.
    for (const id of deletingMilestones) touched.delete(id);

    return {
        errors,
        milestoneUpdates,
        taskUpdates,
        milestoneDeletes,
        taskDeletes: [...taskDeletes],
        touchedMilestoneIds: [...touched],
    };
}

// --- 4. apply ----------------------------------------------------------------

// Non-blocking date warnings, one per re-dated item that falls outside its
// phase window. `project` is the row getOwnedProject returns (lower-case keys).
function collectWarnings(plan, current, project) {
    const phaseOfMilestone = new Map(current.milestones.map((m) => [m.milestoneid, m.phase]));
    const nameOfMilestone = new Map(current.milestones.map((m) => [m.milestoneid, m.name]));
    const warnings = [];
    for (const u of plan.milestoneUpdates) {
        if (!u.dueDate) continue;
        const w = dateWindowWarning(phaseOfMilestone.get(u.milestoneId), u.dueDate, project);
        if (w) warnings.push(`${u.name || nameOfMilestone.get(u.milestoneId)}: ${w}`);
    }
    const taskNames = new Map(current.tasks.map((t) => [t.taskid, t.taskname]));
    for (const u of plan.taskUpdates) {
        if (!u.dueDate) continue;
        const w = dateWindowWarning(phaseOfMilestone.get(u.milestoneId), u.dueDate, project);
        if (w) warnings.push(`${u.name || taskNames.get(u.taskId)}: ${w}`);
    }
    return warnings;
}

// Locks the project's milestones and tasks, decides, then writes. `client` is
// the transaction client; throwing rolls everything back.
async function applyTimelineChanges(client, project, changes) {
    const run = (sql, params) => client.query(sql, params);

    // Lock first so a Site Manager's progress submission (which locks the task
    // row too) and this edit take turns instead of racing.
    const milestonesResult = await run(
        `SELECT milestoneId, name, dueDate, phase
           FROM milestones
          WHERE projectId = $1
          FOR UPDATE`,
        [project.projectid]
    );
    const tasksResult = await run(
        `SELECT t.taskId, t.milestoneId, t.taskName, t.status, t.dueDate
           FROM tasks t
           JOIN milestones m ON m.milestoneId = t.milestoneId
          WHERE m.projectId = $1
          FOR UPDATE OF t`,
        [project.projectid]
    );
    const locks = await findTaskLocks(run, tasksResult.rows.map((t) => t.taskid));

    const current = { milestones: milestonesResult.rows, tasks: tasksResult.rows, locks };
    const plan = planTimelineChanges(current, changes);

    if (plan.errors.length) {
        const first = plan.errors[0].message;
        const more = plan.errors.length > 1 ? ` (${plan.errors.length - 1} more problem${plan.errors.length > 2 ? "s" : ""})` : "";
        throw httpError(409, `${first}${more} Nothing was saved.`, { errors: plan.errors });
    }

    // Tasks before milestones: a task row cannot outlive its milestone.
    if (plan.taskDeletes.length) {
        await run("DELETE FROM tasks WHERE taskId = ANY($1::uuid[])", [plan.taskDeletes]);
    }
    if (plan.milestoneDeletes.length) {
        await run("DELETE FROM milestones WHERE milestoneId = ANY($1::uuid[])", [plan.milestoneDeletes]);
    }
    for (const u of plan.milestoneUpdates) {
        await run(
            `UPDATE milestones
                SET name = COALESCE($2::varchar, name),
                    dueDate = COALESCE($3::date, dueDate)
              WHERE milestoneId = $1`,
            [u.milestoneId, u.name, u.dueDate]
        );
    }
    for (const u of plan.taskUpdates) {
        await run(
            `UPDATE tasks
                SET taskName = COALESCE($2::varchar, taskName),
                    dueDate = COALESCE($3::date, dueDate),
                    -- A new due date starts the overdue alert over: it is sent
                    -- once per task, so without this a task that was overdue
                    -- and then re-dated would never alert again.
                    scheduleVarianceAlertSent = CASE WHEN $3::date IS NOT NULL THEN FALSE ELSE scheduleVarianceAlertSent END,
                    lastUpdatedAt = NOW()
              WHERE taskId = $1`,
            [u.taskId, u.name, u.dueDate]
        );
    }

    // Progress and schedule status come from the tasks and the due date, so
    // recalculate every milestone whose tasks or date changed.
    for (const id of plan.touchedMilestoneIds) {
        await recalcMilestoneProgress(client, id);
    }

    return {
        updatedMilestones: plan.milestoneUpdates.length,
        updatedTasks: plan.taskUpdates.length,
        deletedMilestones: plan.milestoneDeletes.length,
        deletedTasks: plan.taskDeletes.length,
        warnings: collectWarnings(plan, current, project),
    };
}

module.exports = {
    MAX_ITEMS,
    parseTimelineChanges,
    findTaskLocks,
    loadTimelineLocks,
    planTimelineChanges,
    applyTimelineChanges,
};