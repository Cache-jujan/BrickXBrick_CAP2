// dailyCheckin.js — daily progress check-ins, shared by the online route
// (routes/checkins.js) and the offline sync (routes/sync.js, type
// "daily_checkin"). One rule set: an offline check-in is only a delivery delay.
//
// A check-in is a report about the PROJECT, made by its Site Manager three
// times a day (Morning, Midday, End of day, Philippine time). It may point at
// tasks, but it NEVER changes a task, a milestone, progress or the task photo
// review flow. It writes to its own tables (migration 048) and nothing else,
// apart from notifications.
//
// Failures throw CheckinError with an HTTP-style `status` and a stable `code`
// (sync maps the code to its reject codes).
const db = require("./db");
const r2 = require("./r2");
const { isUUID } = require("./uuid");
const { notify } = require("./notify");

const SLOTS = ["Morning", "Midday", "EndOfDay"];
const SLOT_LABEL = { Morning: "Morning", Midday: "Midday", EndOfDay: "End of day" };
const SITE_STATUSES = ["On Track", "Delayed", "Blocked"];
const SETTING_KEY = { Morning: "checkin_window_morning", Midday: "checkin_window_midday", EndOfDay: "checkin_window_endofday" };
const DEFAULT_WINDOWS = { Morning: "05:00-10:00", Midday: "10:00-14:00", EndOfDay: "14:00-21:00" };

const MAX_PHOTOS = 3;
const MAX_LINKED_TASKS = 20;
const MAX_AGE_MS = 72 * 60 * 60 * 1000; // same as the phone's offline queue
const FUTURE_SKEW_MS = 5 * 60 * 1000; // a phone clock a little ahead is fine
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000; // UTC+8, no daylight saving

class CheckinError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    // The error handler returns details, so clients can read the stable code.
    this.details = { code, ...(details || {}) };
  }
}

// ---- time -------------------------------------------------------------------

// A Date as Philippine calendar day + minutes since midnight.
function manilaParts(date) {
  const shifted = new Date(date.getTime() + MANILA_OFFSET_MS);
  const iso = shifted.toISOString();
  return { date: iso.slice(0, 10), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

function parseWindow(text) {
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(String(text || "").trim());
  if (!m) return null;
  const [h1, m1, h2, m2] = m.slice(1).map(Number);
  if (h1 > 23 || h2 > 24 || m1 > 59 || m2 > 59) return null;
  const start = h1 * 60 + m1;
  const end = h2 * 60 + m2;
  return end > start ? { start, end } : null;
}

const hhmm = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

// { Morning: { start, end, text }, ... } from system_settings, with the defaults
// for anything missing or malformed so a bad setting can never block a check-in.
async function loadWindows(query = db.query) {
  const result = await query(
    "SELECT settingKey, settingValue FROM system_settings WHERE settingKey = ANY($1)",
    [Object.values(SETTING_KEY)]
  );
  const stored = new Map(result.rows.map((r) => [r.settingkey, r.settingvalue]));
  const windows = {};
  for (const slot of SLOTS) {
    const parsed = parseWindow(stored.get(SETTING_KEY[slot])) || parseWindow(DEFAULT_WINDOWS[slot]);
    windows[slot] = { ...parsed, text: `${hhmm(parsed.start)}-${hhmm(parsed.end)}` };
  }
  return windows;
}

function isOnTime(slot, minutes, windows) {
  const w = windows[slot];
  return minutes >= w.start && minutes < w.end;
}

// The slot a person is most likely making right now: the open window, else the
// next one to open, else the last of the day.
function suggestSlot(minutes, windows) {
  for (const slot of SLOTS) if (isOnTime(slot, minutes, windows)) return slot;
  for (const slot of SLOTS) if (minutes < windows[slot].start) return slot;
  return "EndOfDay";
}

// Submitted | Open | Upcoming | Missed for one slot on one Philippine day.
function slotState({ slot, day, now, windows, submitted }) {
  if (submitted) return "Submitted";
  const today = manilaParts(now);
  if (day < today.date) return "Missed";
  if (day > today.date) return "Upcoming";
  const w = windows[slot];
  if (today.minutes < w.start) return "Upcoming";
  if (today.minutes < w.end) return "Open";
  return "Missed";
}

// ---- input ------------------------------------------------------------------

function cleanText(value, field, { required, max }) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new CheckinError(400, "INVALID_FIELDS", `${field} is required`);
    return null;
  }
  if (typeof value !== "string") throw new CheckinError(400, "INVALID_FIELDS", `${field} must be text`);
  const text = value.trim();
  if (!text) {
    if (required) throw new CheckinError(400, "INVALID_FIELDS", `${field} is required`);
    return null;
  }
  if (text.length > max) throw new CheckinError(400, "INVALID_FIELDS", `${field} must be ${max} characters or fewer`);
  return text;
}

/**
 * Validates and normalises a check-in. Pure. `now` is injectable for tests.
 * Returns { clientSubmissionId, projectId, slot, capturedAt (Date), checkinDate,
 *           minutes, siteStatus, summary, issues, needsPmAction, taskIds, photoUrls }.
 */
function normalizeCheckin(input, now = new Date()) {
  const data = input || {};
  if (!isUUID(data.clientSubmissionId)) throw new CheckinError(400, "INVALID_FIELDS", "clientSubmissionId must be a UUID");
  if (!isUUID(data.projectId)) throw new CheckinError(400, "PROJECT_NOT_FOUND", "projectId must be the id of a project");
  if (!SLOTS.includes(data.slot)) throw new CheckinError(400, "INVALID_FIELDS", `slot must be one of: ${SLOTS.join(", ")}`);
  if (!SITE_STATUSES.includes(data.siteStatus)) {
    throw new CheckinError(400, "INVALID_FIELDS", `siteStatus must be one of: ${SITE_STATUSES.join(", ")}`);
  }

  const capturedAt = new Date(data.capturedAt);
  if (typeof data.capturedAt !== "string" || Number.isNaN(capturedAt.getTime())) {
    throw new CheckinError(400, "INVALID_FIELDS", "capturedAt must be a date and time");
  }
  if (capturedAt.getTime() > now.getTime() + FUTURE_SKEW_MS) {
    throw new CheckinError(400, "INVALID_FIELDS", "capturedAt can't be in the future. Check the phone's clock.");
  }
  if (now.getTime() - capturedAt.getTime() > MAX_AGE_MS) {
    throw new CheckinError(400, "TOO_OLD", "This check-in is more than 72 hours old and can no longer be sent.");
  }

  const summary = cleanText(data.summary, "summary", { required: true, max: 2000 });
  const issues = cleanText(data.issues, "issues", { required: false, max: 2000 });
  const needsPmAction = data.needsPmAction === undefined || data.needsPmAction === null ? false : data.needsPmAction;
  if (typeof needsPmAction !== "boolean") throw new CheckinError(400, "INVALID_FIELDS", "needsPmAction must be true or false");
  if (needsPmAction && !issues) {
    throw new CheckinError(400, "INVALID_FIELDS", "Describe the issue that needs your Project Manager's action");
  }

  const taskIds = data.taskIds === undefined || data.taskIds === null ? [] : data.taskIds;
  if (!Array.isArray(taskIds) || taskIds.length > MAX_LINKED_TASKS || !taskIds.every(isUUID)) {
    throw new CheckinError(400, "INVALID_FIELDS", `taskIds must be a list of at most ${MAX_LINKED_TASKS} task ids`);
  }
  const photoUrls = data.photoUrls === undefined || data.photoUrls === null ? [] : data.photoUrls;
  if (
    !Array.isArray(photoUrls) ||
    photoUrls.length > MAX_PHOTOS ||
    !photoUrls.every((u) => typeof u === "string" && u.length > 0 && u.length <= 1000)
  ) {
    throw new CheckinError(400, "INVALID_FIELDS", `photoUrls must be a list of at most ${MAX_PHOTOS} photos`);
  }

  const parts = manilaParts(capturedAt);
  return {
    clientSubmissionId: data.clientSubmissionId,
    projectId: data.projectId,
    slot: data.slot,
    capturedAt,
    checkinDate: parts.date,
    minutes: parts.minutes,
    siteStatus: data.siteStatus,
    summary,
    issues,
    needsPmAction,
    taskIds: [...new Set(taskIds)],
    photoUrls: [...new Set(photoUrls)],
  };
}

// ---- photos -----------------------------------------------------------------

// Only photos this server stored for THIS project count: checkins/<projectId>/...
function photoKeyOk(url, projectId, keyFromUrl = r2.keyFromPublicUrl) {
  const key = keyFromUrl(url);
  return Boolean(key && key.startsWith(`checkins/${projectId}/`));
}

/**
 * checkinPhotoExists(url, projectId, deps?) -> true | false
 * Is `url` a photo stored for this project? A storage problem (timeout, network)
 * THROWS, so the sync keeps the item pending instead of rejecting it.
 */
async function checkinPhotoExists(url, projectId, deps = {}) {
  const keyFromUrl = deps.keyFromPublicUrl || r2.keyFromPublicUrl;
  const objectExists = deps.objectExists || r2.objectExists;
  if (!photoKeyOk(url, projectId, keyFromUrl)) return false;
  return objectExists(keyFromUrl(url));
}

// ---- submit -----------------------------------------------------------------

async function loadProject(query, projectId) {
  const result = await query(
    "SELECT projectId, name, status, projectManagerId, siteManagerId FROM projects WHERE projectId = $1",
    [projectId]
  );
  if (result.rowCount === 0) throw new CheckinError(404, "PROJECT_NOT_FOUND", `Project ${projectId} not found`);
  return result.rows[0];
}

function checkinCode(error) {
  // The two unique rules fail with the same SQLSTATE; the constraint says which.
  return error.constraint === "daily_checkins_one_per_slot" ? "CHECKIN_EXISTS" : "CLIENT_ID_IN_USE";
}

/**
 * submitCheckin({ user, input, verifyPhoto?, now? }, deps?)
 *   user         { id } the Site Manager
 *   input        see normalizeCheckin
 *   verifyPhoto  optional async (url, projectId) => boolean. Sync passes a
 *                storage check; the online route relies on the prefix check
 *                (the URL was returned by our own upload route moments ago).
 *   deps         { query, withTransaction } for tests
 * Returns { checkin, replayed }. replayed = this clientSubmissionId was already
 * saved by the same user for the same project.
 */
async function submitCheckin({ user, input, verifyPhoto, now = new Date() }, deps = {}) {
  const query = deps.query || db.query;
  const withTransaction = deps.withTransaction || db.withTransaction;

  const data = normalizeCheckin(input, now);

  // Replay first: a retried sync returns the original row, even if the project
  // has been closed since.
  const existing = await query("SELECT * FROM daily_progress_checkins WHERE clientSubmissionId = $1", [data.clientSubmissionId]);
  if (existing.rowCount > 0) {
    const row = existing.rows[0];
    if (row.submittedby === user.id && row.projectid === data.projectId) return { checkin: row, replayed: true };
    throw new CheckinError(409, "CLIENT_ID_IN_USE", "clientSubmissionId is already in use by a different check-in");
  }

  const project = await loadProject(query, data.projectId);
  if (project.sitemanagerid !== user.id) {
    throw new CheckinError(403, "NOT_YOUR_PROJECT", "You can only check in on a project you are the Site Manager of");
  }
  if (project.status !== "Active") {
    throw new CheckinError(409, "PROJECT_NOT_ACTIVE", `This project is ${project.status}; check-ins can only be made on an Active project`);
  }

  const taken = await query(
    `SELECT checkinId FROM daily_progress_checkins
      WHERE projectId = $1 AND checkinDate = $2 AND slot = $3 AND submittedBy = $4`,
    [data.projectId, data.checkinDate, data.slot, user.id]
  );
  if (taken.rowCount > 0) {
    throw new CheckinError(
      409,
      "CHECKIN_EXISTS",
      `You already sent the ${SLOT_LABEL[data.slot]} check-in for this project on ${data.checkinDate}`,
      { checkinId: taken.rows[0].checkinid }
    );
  }

  if (data.taskIds.length > 0) {
    // Tasks must be this project's and assigned to this Site Manager.
    const tasks = await query(
      `SELECT t.taskId FROM tasks t JOIN milestones m ON m.milestoneId = t.milestoneId
        WHERE t.taskId = ANY($1) AND m.projectId = $2 AND t.assignedTo = $3`,
      [data.taskIds, data.projectId, user.id]
    );
    if (tasks.rowCount !== data.taskIds.length) {
      throw new CheckinError(400, "TASK_NOT_FOUND", "One of the tasks isn't one of your tasks on this project");
    }
  }

  for (const url of data.photoUrls) {
    if (!photoKeyOk(url, data.projectId)) {
      throw new CheckinError(400, "MISSING_PHOTO", "A photo isn't one uploaded for this project's check-ins");
    }
    if (verifyPhoto && !(await verifyPhoto(url, data.projectId))) {
      throw new CheckinError(400, "MISSING_PHOTO", "A photo could not be found. Please add it again.");
    }
  }

  const windows = await loadWindows(query);
  const onTime = isOnTime(data.slot, data.minutes, windows);

  try {
    const checkin = await withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO daily_progress_checkins
           (clientSubmissionId, projectId, submittedBy, checkinDate, slot, capturedAt,
            siteStatus, summary, issues, needsPmAction, onTime)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          data.clientSubmissionId, data.projectId, user.id, data.checkinDate, data.slot, data.capturedAt,
          data.siteStatus, data.summary, data.issues, data.needsPmAction, onTime,
        ]
      );
      const row = inserted.rows[0];
      for (let i = 0; i < data.photoUrls.length; i += 1) {
        await client.query(
          "INSERT INTO daily_checkin_photos (checkinId, photoUrl, sortOrder) VALUES ($1, $2, $3)",
          [row.checkinid, data.photoUrls[i], i + 1]
        );
      }
      for (const taskId of data.taskIds) {
        await client.query("INSERT INTO daily_checkin_tasks (checkinId, taskId) VALUES ($1, $2)", [row.checkinid, taskId]);
      }
      if (data.needsPmAction) {
        await notify(client, {
          recipientIds: [project.projectmanagerid],
          excludeUserId: user.id,
          type: "CheckinIssue",
          entityType: "Checkin",
          entityId: row.checkinid,
          message: `${SLOT_LABEL[data.slot]} check-in on "${project.name}" needs your action: ${data.issues}`,
        });
      }
      return row;
    });
    return { checkin, replayed: false };
  } catch (error) {
    if (error.code === "23505") {
      // Two phones, or a replay racing its own first attempt.
      const code = checkinCode(error);
      if (code === "CLIENT_ID_IN_USE") {
        const again = await query("SELECT * FROM daily_progress_checkins WHERE clientSubmissionId = $1", [data.clientSubmissionId]);
        if (again.rowCount > 0 && again.rows[0].submittedby === user.id) return { checkin: again.rows[0], replayed: true };
      }
      throw new CheckinError(409, code, code === "CHECKIN_EXISTS"
        ? `You already sent the ${SLOT_LABEL[data.slot]} check-in for this project on ${data.checkinDate}`
        : "clientSubmissionId is already in use by a different check-in");
    }
    throw error;
  }
}

// ---- Site Manager: today ---------------------------------------------------------

/**
 * Today's three slots for every Active project this Site Manager runs.
 * Returns { today, now, suggestedSlot, windows, projects: [{ projectId, name, slots: [
 *   { slot, label, window, state, checkinId } ] }] }.
 */
async function loadToday(user, { now = new Date(), query = db.query } = {}) {
  const windows = await loadWindows(query);
  const today = manilaParts(now);
  const projects = await query(
    "SELECT projectId, name FROM projects WHERE siteManagerId = $1 AND status = 'Active' ORDER BY name",
    [user.id]
  );
  const ids = projects.rows.map((p) => p.projectid);
  const done = ids.length
    ? await query(
        `SELECT projectId, slot, checkinId FROM daily_progress_checkins
          WHERE projectId = ANY($1) AND submittedBy = $2 AND checkinDate = $3`,
        [ids, user.id, today.date]
      )
    : { rows: [] };
  const byKey = new Map(done.rows.map((r) => [`${r.projectid}:${r.slot}`, r.checkinid]));

  return {
    today: today.date,
    now: now.toISOString(),
    suggestedSlot: suggestSlot(today.minutes, windows),
    windows: Object.fromEntries(SLOTS.map((s) => [s, windows[s].text])),
    projects: projects.rows.map((p) => ({
      projectId: p.projectid,
      name: p.name,
      slots: SLOTS.map((slot) => {
        const checkinId = byKey.get(`${p.projectid}:${slot}`) || null;
        return {
          slot,
          label: SLOT_LABEL[slot],
          window: windows[slot].text,
          state: slotState({ slot, day: today.date, now, windows, submitted: Boolean(checkinId) }),
          checkinId,
        };
      }),
    })),
  };
}

// ---- Project Manager: list + review ----------------------------------------------

function addDaysIso(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The check-ins of one project for a date range (Philippine days, inclusive),
 * newest first, plus a day-by-slot grid showing what was sent and what was missed.
 * Days before the project was activated are not counted as missed.
 */
async function loadProjectCheckins(projectId, { from, to, now = new Date(), query = db.query } = {}) {
  const today = manilaParts(now).date;
  const end = to || today;
  const start = from || addDaysIso(end, -6);
  if (start > end) throw new CheckinError(400, "INVALID_FIELDS", "from can't be after to");
  const spanDays = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
  if (spanDays > 30) throw new CheckinError(400, "INVALID_FIELDS", "Choose a range of 31 days or fewer");

  const windows = await loadWindows(query);
  const project = await query(
    `SELECT projectId, name, status, activatedAt, actualCompletionDate, siteManagerId FROM projects WHERE projectId = $1`,
    [projectId]
  );
  if (project.rowCount === 0) throw new CheckinError(404, "PROJECT_NOT_FOUND", `Project ${projectId} not found`);
  const p = project.rows[0];

  const rows = await query(
    `SELECT c.checkinId, c.slot, to_char(c.checkinDate, 'YYYY-MM-DD') AS day, c.capturedAt, c.submittedAt,
            c.siteStatus, c.summary, c.issues, c.needsPmAction, c.onTime,
            u.name AS submittedByName,
            r.decision, r.comment AS reviewComment, r.reviewedAt, ru.name AS reviewedByName
       FROM daily_progress_checkins c
       JOIN users u ON u.userId = c.submittedBy
       LEFT JOIN daily_progress_reviews r ON r.checkinId = c.checkinId
       LEFT JOIN users ru ON ru.userId = r.reviewedBy
      WHERE c.projectId = $1 AND c.checkinDate BETWEEN $2 AND $3
      ORDER BY c.checkinDate DESC, CASE c.slot WHEN 'EndOfDay' THEN 3 WHEN 'Midday' THEN 2 ELSE 1 END DESC`,
    [projectId, start, end]
  );
  const ids = rows.rows.map((r) => r.checkinid);
  const photos = ids.length
    ? await query("SELECT checkinId, photoUrl FROM daily_checkin_photos WHERE checkinId = ANY($1) ORDER BY sortOrder", [ids])
    : { rows: [] };
  const tasks = ids.length
    ? await query(
        `SELECT ct.checkinId, t.taskId, t.taskName FROM daily_checkin_tasks ct
           JOIN tasks t ON t.taskId = ct.taskId WHERE ct.checkinId = ANY($1) ORDER BY t.taskName`,
        [ids]
      )
    : { rows: [] };

  const checkins = rows.rows.map((r) => ({
    checkinId: r.checkinid,
    day: r.day,
    slot: r.slot,
    slotLabel: SLOT_LABEL[r.slot],
    capturedAt: r.capturedat,
    submittedAt: r.submittedat,
    submittedByName: r.submittedbyname,
    siteStatus: r.sitestatus,
    summary: r.summary,
    issues: r.issues,
    needsPmAction: r.needspmaction,
    onTime: r.ontime,
    photos: photos.rows.filter((x) => x.checkinid === r.checkinid).map((x) => x.photourl),
    tasks: tasks.rows.filter((x) => x.checkinid === r.checkinid).map((x) => ({ taskId: x.taskid, taskName: x.taskname })),
    review: r.decision
      ? { decision: r.decision, comment: r.reviewcomment, reviewedAt: r.reviewedat, reviewedByName: r.reviewedbyname }
      : null,
  }));

  // Check-ins are only expected while the project is Active. Before activation
  // (and after it is closed) a slot is "NotRequired".
  const activatedDay = p.activatedat ? manilaParts(new Date(p.activatedat)).date : null;
  const closedDay =
    p.status === "Completed" || p.status === "Cancelled" || p.status === "Archived"
      ? p.actualcompletiondate
        ? dayKey(p.actualcompletiondate)
        : null
      : null;
  const submittedKey = new Set(checkins.map((c) => `${c.day}:${c.slot}`));
  const grid = [];
  for (let day = end; day >= start; day = addDaysIso(day, -1)) {
    const required = Boolean(activatedDay) && day >= activatedDay && (!closedDay || day <= closedDay) && p.status !== "Draft";
    grid.push({
      day,
      slots: SLOTS.map((slot) => {
        const submitted = submittedKey.has(`${day}:${slot}`);
        const state = submitted ? "Submitted" : required ? slotState({ slot, day, now, windows, submitted: false }) : "NotRequired";
        return { slot, label: SLOT_LABEL[slot], state };
      }),
    });
  }

  return {
    project: { projectId: p.projectid, name: p.name, status: p.status },
    from: start,
    to: end,
    windows: Object.fromEntries(SLOTS.map((s) => [s, windows[s].text])),
    grid,
    checkins,
    counts: {
      total: checkins.length,
      needsAction: checkins.filter((c) => c.needsPmAction && !c.review).length,
      unreviewed: checkins.filter((c) => !c.review).length,
      missed: grid.reduce((a, d) => a + d.slots.filter((s) => s.state === "Missed").length, 0),
    },
  };
}

// A DATE read by node-postgres is local midnight; read the local calendar day.
function dayKey(value) {
  if (typeof value === "string") return value.slice(0, 10);
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The Project Manager of the project Acknowledges or Flags a check-in.
 * A Flag needs a comment and tells the Site Manager. Neither changes anything
 * about the project's tasks or progress. A later review replaces the earlier one.
 */
async function reviewCheckin({ user, checkinId, decision, comment }, deps = {}) {
  const withTransaction = deps.withTransaction || db.withTransaction;
  if (!isUUID(checkinId)) throw new CheckinError(404, "CHECKIN_NOT_FOUND", "Check-in not found");
  if (!["Acknowledged", "Flagged"].includes(decision)) {
    throw new CheckinError(400, "INVALID_FIELDS", "decision must be Acknowledged or Flagged");
  }
  const text = cleanText(comment, "comment", { required: decision === "Flagged", max: 500 });

  return withTransaction(async (client) => {
    const found = await client.query(
      `SELECT c.checkinId, c.slot, to_char(c.checkinDate, 'YYYY-MM-DD') AS day, c.submittedBy,
              p.name AS projectName, p.projectManagerId
         FROM daily_progress_checkins c JOIN projects p ON p.projectId = c.projectId
        WHERE c.checkinId = $1 FOR UPDATE OF c`,
      [checkinId]
    );
    if (found.rowCount === 0) throw new CheckinError(404, "CHECKIN_NOT_FOUND", "Check-in not found");
    const c = found.rows[0];
    if (c.projectmanagerid !== user.id) {
      throw new CheckinError(403, "NOT_YOUR_PROJECT", "Only the Project Manager of this project can review its check-ins");
    }
    const saved = await client.query(
      `INSERT INTO daily_progress_reviews (checkinId, reviewedBy, decision, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (checkinId) DO UPDATE
         SET reviewedBy = EXCLUDED.reviewedBy, decision = EXCLUDED.decision,
             comment = EXCLUDED.comment, reviewedAt = NOW()
       RETURNING *`,
      [checkinId, user.id, decision, text]
    );
    if (decision === "Flagged") {
      await notify(client, {
        recipientIds: [c.submittedby],
        excludeUserId: user.id,
        type: "CheckinFlagged",
        entityType: "Checkin",
        entityId: checkinId,
        message: `Your ${SLOT_LABEL[c.slot]} check-in on "${c.projectname}" (${c.day}) was flagged: ${text}`,
      });
    }
    return saved.rows[0];
  });
}

module.exports = {
  SLOTS,
  SLOT_LABEL,
  SITE_STATUSES,
  DEFAULT_WINDOWS,
  MAX_PHOTOS,
  CheckinError,
  manilaParts,
  parseWindow,
  loadWindows,
  isOnTime,
  suggestSlot,
  slotState,
  normalizeCheckin,
  checkinPhotoExists,
  photoKeyOk,
  submitCheckin,
  loadToday,
  loadProjectCheckins,
  reviewCheckin,
};
