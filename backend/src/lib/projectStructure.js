// projectStructure.js — F2: a project's starting milestones and tasks, taken
// from a template or copied from a past project.
//
// The structure is COPIED when the project is created. Nothing stays linked:
// later changes to a template or to the source project never reach the new one.
// Only names, phases, the Planning owner (GM/PM), the permit/document code and
// the due date (re-based onto the new project's own dates) are carried over.
// Progress, completion, photos, documents, assignees, tickets, expenses,
// receipts, notes and the BOM are never copied.
//
// Everything here except the load*/insertStructure functions is pure.
const { isUUID } = require("./uuid");
const { dateWindowWarning } = require("./scheduleWindows");
const { deriveStatus } = require("./milestoneProgress");

const MODES = ["blank", "template", "copy"];
const MAX_IDS = 1000;

function httpError(status, message, details) {
  const err = new Error(message);
  err.status = status;
  if (details) err.details = details;
  return err;
}

// ---- dates ------------------------------------------------------------------

// node-postgres returns a DATE as local midnight; read the local calendar day.
function dateKey(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayNumber(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

function addDays(iso, days) {
  const d = new Date((dayNumber(iso) + days) * 86400000);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  return dayNumber(toIso) - dayNumber(fromIso);
}

// Planning counts from the target date of development, Construction from the
// target date of construction (falling back to development).
function anchorFor(phase, project) {
  const start = dateKey(project.startdate ?? project.startDate);
  const construction = dateKey(project.constructionstartdate ?? project.constructionStartDate);
  return phase === "Planning" ? start : construction || start;
}

// ---- request ----------------------------------------------------------------

function idList(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_IDS || !value.every(isUUID)) {
    throw httpError(400, `${field} must be a list of ids`);
  }
  return [...new Set(value)];
}

const MAX_OTHER_DOCUMENTS = 10;
const MAX_DOCUMENT_NAME = 120;

// The "Others" documents the GM typed in: trimmed, blanks and repeats dropped.
function nameList(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_OTHER_DOCUMENTS || !value.every((v) => typeof v === "string")) {
    throw httpError(400, `${field} must be a list of at most ${MAX_OTHER_DOCUMENTS} names`);
  }
  const names = value.map((v) => v.trim()).filter(Boolean);
  if (names.some((n) => n.length > MAX_DOCUMENT_NAME)) {
    throw httpError(400, `Each of ${field} must be at most ${MAX_DOCUMENT_NAME} characters`);
  }
  return [...new Set(names)];
}

/**
 * Reads body.start. Missing = a blank sheet, so existing clients keep working.
 *   { mode: "blank" }
 *   { mode: "template", templateId, includeTaskIds?, excludeTaskIds?, otherDocuments? }
 *   { mode: "copy", sourceProjectId, excludeTaskIds? }
 */
function parseStartRequest(start) {
  if (start === undefined || start === null) return { mode: "blank" };
  if (typeof start !== "object" || Array.isArray(start)) throw httpError(400, "start must be an object");
  if (!MODES.includes(start.mode)) throw httpError(400, `start.mode must be one of: ${MODES.join(", ")}`);
  if (start.mode === "blank") return { mode: "blank" };

  const excludeTaskIds = new Set(idList(start.excludeTaskIds, "excludeTaskIds"));
  if (start.mode === "template") {
    if (!isUUID(start.templateId)) throw httpError(400, "Choose a template");
    return {
      mode: "template",
      templateId: start.templateId,
      includeTaskIds: new Set(idList(start.includeTaskIds, "includeTaskIds")),
      excludeTaskIds,
      otherDocuments: nameList(start.otherDocuments, "otherDocuments"),
    };
  }
  if (!isUUID(start.sourceProjectId)) throw httpError(400, "Choose the project to copy");
  return { mode: "copy", sourceProjectId: start.sourceProjectId, excludeTaskIds };
}

// ---- loading ----------------------------------------------------------------

// Normalised source: { kind, id, name, milestones: [{ id, name, phase, offset,
// tasks: [{ id, name, handledBy, requirementCode, offset, defaultIncluded,
// selectable, hint }] }] }. `offset` = days after the phase anchor.

async function loadTemplateSource(run, templateId) {
  const t = await run(
    `SELECT templateId, name FROM project_templates WHERE templateId = $1 AND isActive`,
    [templateId]
  );
  if (t.rowCount === 0) throw httpError(404, "Template not found");
  const rows = await run(
    `SELECT m.templateMilestoneId AS mid, m.sequence AS mseq, m.name AS mname, m.phase, m.dueOffsetDays AS mdue,
            k.templateTaskId AS tid, k.sequence AS kseq, k.name AS kname, k.handledBy,
            k.requirementCode, k.defaultIncluded, k.hint, k.dueOffsetDays AS kdue
       FROM project_template_milestones m
       LEFT JOIN project_template_tasks k ON k.templateMilestoneId = m.templateMilestoneId
      WHERE m.templateId = $1
      ORDER BY m.sequence, k.sequence`,
    [templateId]
  );
  const milestones = [];
  const byId = new Map();
  for (const r of rows.rows) {
    let m = byId.get(r.mid);
    if (!m) {
      m = { id: r.mid, name: r.mname, phase: r.phase, offset: Number(r.mdue), tasks: [] };
      byId.set(r.mid, m);
      milestones.push(m);
    }
    if (r.tid) {
      m.tasks.push({
        id: r.tid,
        name: r.kname,
        handledBy: r.handledby || null,
        requirementCode: r.requirementcode || null,
        offset: Number(r.kdue),
        defaultIncluded: r.defaultincluded,
        selectable: Boolean(r.requirementcode),
        hint: r.hint || null,
      });
    }
  }
  return { kind: "template", id: templateId, name: t.rows[0].name, milestones };
}

async function loadCopySource(run, projectId) {
  const p = await run(
    `SELECT projectId, name, startDate, constructionStartDate FROM projects WHERE projectId = $1`,
    [projectId]
  );
  if (p.rowCount === 0) throw httpError(404, "Project to copy not found");
  const src = p.rows[0];

  const ms = await run(
    `SELECT milestoneId, name, phase, dueDate FROM milestones
      WHERE projectId = $1 ORDER BY dueDate ASC, sortOrder ASC NULLS LAST, name ASC`,
    [projectId]
  );
  const ts = ms.rowCount
    ? await run(
        `SELECT taskId, milestoneId, taskName, handledBy, requirementCode, dueDate
           FROM tasks WHERE milestoneId = ANY($1)
          ORDER BY dueDate ASC, sortOrder ASC NULLS LAST, taskName ASC`,
        [ms.rows.map((m) => m.milestoneid)]
      )
    : { rows: [] };

  const milestones = ms.rows.map((m) => {
    const anchor = anchorFor(m.phase, src);
    return {
      id: m.milestoneid,
      name: m.name,
      phase: m.phase,
      offset: anchor ? daysBetween(anchor, dateKey(m.duedate)) : 0,
      tasks: ts.rows
        .filter((t) => t.milestoneid === m.milestoneid)
        .map((t) => ({
          id: t.taskid,
          name: t.taskname,
          handledBy: m.phase === "Planning" ? t.handledby || "PM" : null,
          requirementCode: t.requirementcode || null,
          offset: anchor ? daysBetween(anchor, dateKey(t.duedate)) : 0,
          defaultIncluded: true,
          selectable: true,
          hint: null,
        })),
    };
  });
  return { kind: "copy", id: projectId, name: src.name, milestones };
}

async function loadSource(run, request) {
  if (request.mode === "template") return loadTemplateSource(run, request.templateId);
  if (request.mode === "copy") return loadCopySource(run, request.sourceProjectId);
  return null;
}

// ---- building ---------------------------------------------------------------

function isTaskIncluded(task, request) {
  if (!task.selectable) return true;
  if (request.excludeTaskIds.has(task.id)) return false;
  if (task.defaultIncluded) return true;
  return request.includeTaskIds?.has(task.id) === true;
}

function checkSelectionIds(source, request) {
  const all = new Map();
  for (const m of source.milestones) for (const t of m.tasks) all.set(t.id, t);
  const bad = (set, label) => {
    for (const id of set || []) {
      const task = all.get(id);
      if (!task) throw httpError(400, `${label} contains a task that isn't part of the chosen ${source.kind}`);
      if (!task.selectable) {
        throw httpError(400, `"${task.name}" can't be removed from a template; only permit documents can`);
      }
    }
  };
  bad(request.excludeTaskIds, "excludeTaskIds");
  bad(request.includeTaskIds, "includeTaskIds");
}

/**
 * Turns a source plus the GM's choices and the new project's dates into the
 * rows to create. Milestones left with no tasks are dropped (and listed).
 */
function buildStructure(source, request, project) {
  if (!source) return { milestones: [], omittedMilestones: [], needsSiteManager: false, counts: { milestones: 0, tasks: 0 }, warnings: [] };
  checkSelectionIds(source, request);

  const window = {
    startdate: dateKey(project.startDate),
    constructionstartdate: dateKey(project.constructionStartDate),
    enddate: dateKey(project.endDate),
  };
  const warnings = [];
  const omittedMilestones = [];
  const milestones = [];

  // "Others" documents join the milestone that holds the permit documents.
  const others = request.otherDocuments || [];
  const otherHome = others.length ? source.milestones.find((m) => m.tasks.some((t) => t.selectable)) : null;

  for (const m of source.milestones) {
    const anchor = anchorFor(m.phase, project);
    const kept = m.tasks.filter((t) => isTaskIncluded(t, request));
    if (m === otherHome) {
      const lastOffset = Math.max(m.offset, ...m.tasks.map((t) => t.offset));
      for (const name of others) {
        kept.push({ id: null, name, handledBy: "PM", requirementCode: null, offset: lastOffset });
      }
    }
    if (kept.length === 0) {
      omittedMilestones.push(m.name);
      continue;
    }
    const dueDate = addDays(anchor, m.offset);
    const mWarn = dateWindowWarning(m.phase, dueDate, window);
    if (mWarn) warnings.push(`${m.name}: ${mWarn}`);

    milestones.push({
      name: m.name,
      phase: m.phase,
      dueDate,
      warning: mWarn,
      sortOrder: milestones.length + 1,
      tasks: kept.map((t, i) => {
        const due = addDays(anchor, t.offset);
        const w = dateWindowWarning(m.phase, due, window);
        if (w) warnings.push(`${t.name}: ${w}`);
        return {
          name: t.name,
          handledBy: m.phase === "Planning" ? t.handledBy || "PM" : null,
          requirementCode: t.requirementCode,
          dueDate: due,
          warning: w,
          sortOrder: i + 1,
        };
      }),
    });
  }

  return {
    milestones,
    omittedMilestones,
    needsSiteManager: milestones.some((m) => m.phase === "Construction"),
    counts: { milestones: milestones.length, tasks: milestones.reduce((a, m) => a + m.tasks.length, 0) },
    warnings,
  };
}

// ---- writing ----------------------------------------------------------------

/**
 * Inserts the built structure inside the caller's transaction.
 * Planning tasks have no assignee (owned by GM/PM); Construction tasks go to the
 * project's Site Manager, which the caller has already required.
 * Milestone status is derived without raising notifications: a brand-new project
 * must not fire "ScheduleVarianceAlert" for every milestone.
 */
async function insertStructure(client, { projectId, createdBy, siteManagerId, structure }) {
  for (const m of structure.milestones) {
    const [y, mo, d] = m.dueDate.split("-").map(Number);
    const status = deriveStatus(new Date(y, mo - 1, d), 0);
    const inserted = await client.query(
      `INSERT INTO milestones (projectId, createdBy, name, dueDate, phase, status, sortOrder)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING milestoneId`,
      [projectId, createdBy, m.name, m.dueDate, m.phase, status, m.sortOrder]
    );
    const milestoneId = inserted.rows[0].milestoneid;
    for (const t of m.tasks) {
      const planning = m.phase === "Planning";
      if (!planning && !siteManagerId) throw httpError(400, "A Site Manager is required for construction tasks");
      await client.query(
        `INSERT INTO tasks (milestoneId, assignedTo, handledBy, taskName, dueDate, sortOrder, requirementCode)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [milestoneId, planning ? null : siteManagerId, planning ? t.handledBy : null, t.name, t.dueDate, t.sortOrder, t.requirementCode]
      );
    }
  }
}

module.exports = {
  MODES,
  dateKey,
  addDays,
  daysBetween,
  anchorFor,
  parseStartRequest,
  loadSource,
  loadTemplateSource,
  loadCopySource,
  buildStructure,
  insertStructure,
};
