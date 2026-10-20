// F10 — Offline queues (SQLite): expenses (Purchaser) and task submissions
// (Site Manager).
//
// Stores what was captured while the device is offline. Each row carries a
// client-generated UUID for idempotency (the server deduplicates on it).
//
// ONE rule decides whether a new entry may be queued, for both queues together:
// canEnqueue(). At 100 pending entries, or when the oldest pending entry is
// older than 72 hours, no NEW entry is accepted — the user must sync first.
// Pending entries are never deleted for being old: they still sync.
//
// Status lifecycle: pending → synced  (purged after sync)
//                          → rejected (kept so the user sees the reason)
//
// Task submissions (offline_task_updates) follow the same life cycle, with
// upper-case status values. A task has at most ONE pending update: a newer one
// replaces it (the server allows one pending-review row per task anyway).
// The photo is a file in the app's documents folder; only its path is stored,
// never the image bytes (a 10 MB Base64 row would slow every query).

import * as SQLite from "expo-sqlite";

const DB_NAME = "offline_queue.db";
const DEFAULT_MAX_PENDING = 100;
const MAX_AGE_MS = 72 * 60 * 60 * 1000; // 72 hours

// Dev-only: EXPO_PUBLIC_QUEUE_LIMIT=3 lowers the limit so the "queue full" path
// can be tested by hand without queueing 100 entries. Ignored in release builds.
function resolveMaxPending() {
  const override = Number(process.env.EXPO_PUBLIC_QUEUE_LIMIT);
  const isDev = typeof __DEV__ !== "undefined" && __DEV__;
  return isDev && Number.isInteger(override) && override > 0 ? override : DEFAULT_MAX_PENDING;
}
const MAX_PENDING = resolveMaxPending();

let db = null;

// ── one connection, kept for the life of the app ─────────────────────────────
// expo-sqlite shares ONE native connection per database file. Opening the file
// again hands back that same connection, and when an older JavaScript handle
// to it is garbage-collected it CLOSES the shared connection. Every later query
// then fails with "NativeDatabase.prepareSync ... NullPointerException" (seen
// on a phone when tapping "Save offline"). So the file is opened once and the
// handle is never replaced. If the connection is closed anyway, reopen a
// fresh, private one and retry the query once.
function isClosedConnectionError(error) {
  return /NativeDatabase|NullPointerException|closed database|database is closed/i.test(String(error?.message ?? error));
}

function guarded(call) {
  try {
    return call(db);
  } catch (error) {
    if (!isClosedConnectionError(error)) throw error;
    console.log("[F10] offline storage connection was closed; reopening it");
    db = SQLite.openDatabaseSync(DB_NAME, { useNewConnection: true });
    return call(db);
  }
}

const run = (sql, params = []) => guarded((d) => d.runSync(sql, params));
const first = (sql, params = []) => guarded((d) => d.getFirstSync(sql, params));
const all = (sql, params = []) => guarded((d) => d.getAllSync(sql, params));
const exec = (sql) => guarded((d) => d.execSync(sql));

export function initDb() {
  if (!db) db = SQLite.openDatabaseSync(DB_NAME); // never re-opened: see above
  exec(`
    CREATE TABLE IF NOT EXISTS offline_expenses (
      uuid          TEXT PRIMARY KEY NOT NULL,
      payload       TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      created_at    TEXT NOT NULL,
      synced_at     TEXT,
      reject_code   TEXT,
      reject_message TEXT
    );
  `);
  exec(`
    CREATE TABLE IF NOT EXISTS offline_task_updates (
      update_id        TEXT PRIMARY KEY NOT NULL,
      task_id          TEXT NOT NULL,
      user_id          TEXT NOT NULL,
      photo_path       TEXT NOT NULL,
      server_photo_url TEXT,
      note             TEXT,
      created_at       TEXT NOT NULL,
      sync_status      TEXT NOT NULL DEFAULT 'PENDING',
      error_code       TEXT,
      error_message    TEXT
    );
  `);
  // Offline-first (app opens and shows your work with no connection):
  //   app_kv        small settings, e.g. the saved sign-in
  //   api_cache     the last answer the server gave for each screen, per user
  //   offline_scans receipt photos waiting to be uploaded for reading (OCR)
  exec(`
    CREATE TABLE IF NOT EXISTS app_kv (
      key   TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
  exec(`
    CREATE TABLE IF NOT EXISTS api_cache (
      key      TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      body     TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      PRIMARY KEY (key, user_id)
    );
  `);
  exec(`
    CREATE TABLE IF NOT EXISTS offline_scans (
      scan_id       TEXT PRIMARY KEY NOT NULL,
      user_id       TEXT NOT NULL,
      file_path     TEXT NOT NULL,
      file_name     TEXT NOT NULL,
      file_type     TEXT NOT NULL,
      mime_type     TEXT NOT NULL,
      context       TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      sync_status   TEXT NOT NULL DEFAULT 'PENDING',
      error_message TEXT
    );
  `);
  purgeExpired();
}

// Tidy up finished business older than 72 hours (rejected and synced rows).
// PENDING rows are never deleted here: dropping someone's unsent work because
// it is old would lose data, and the server decides what to do with it.
export function purgeExpired() {
  if (!db) return;
  const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString();
  run("DELETE FROM offline_expenses WHERE created_at < ? AND status != 'pending';", [cutoff]);
  run("DELETE FROM offline_task_updates WHERE created_at < ? AND sync_status != 'PENDING';", [cutoff]);
  run("DELETE FROM offline_scans WHERE created_at < ? AND sync_status != 'PENDING';", [cutoff]);
}

// ── the one queue rule ───────────────────────────────────────────────────────

// Pure: decide from three numbers, so it can be tested without a database.
//   pendingCount    entries already waiting (both queues, minus any entry the
//                   new one will replace)
//   oldestCreatedAt ISO time of the oldest of those, or null
// Returns { allowed, reason: null | "LIMIT" | "STALE", message }.
export function evaluateEnqueue({
  pendingCount,
  oldestCreatedAt,
  now = Date.now(),
  maxPending = MAX_PENDING,
  maxAgeMs = MAX_AGE_MS,
}) {
  if (pendingCount >= maxPending) {
    return {
      allowed: false,
      reason: "LIMIT",
      message: `The offline queue is full (${maxPending} entries). Reconnect to sync before saving more.`,
    };
  }
  if (oldestCreatedAt && now - new Date(oldestCreatedAt).getTime() > maxAgeMs) {
    return {
      allowed: false,
      reason: "STALE",
      message: "Some saved entries are more than 72 hours old and have not synced. Reconnect to sync them before saving more.",
    };
  }
  return { allowed: true, reason: null, message: "" };
}

// May one more entry be queued right now? Counts ALL queues, so the 100-entry
// and 72-hour rules cannot drift apart. Pass replacingTaskId when a new task
// submission will replace that task's pending one (so it does not count twice).
export function canEnqueue({ replacingTaskId = null, now = Date.now() } = {}) {
  if (!db) return { allowed: false, reason: "NO_DB", message: "Offline storage is not ready yet." };
  const skip = replacingTaskId ?? "";
  const row = first(
    `SELECT COUNT(*) AS c, MIN(created_at) AS oldest FROM (
       SELECT created_at FROM offline_expenses WHERE status = 'pending'
       UNION ALL
       SELECT created_at FROM offline_task_updates
        WHERE sync_status = 'PENDING' AND task_id != ?
       UNION ALL
       SELECT created_at FROM offline_scans WHERE sync_status = 'PENDING'
     );`,
    [skip]
  );
  return evaluateEnqueue({ pendingCount: row?.c ?? 0, oldestCreatedAt: row?.oldest ?? null, now });
}

// Queue one expense for later sync. Returns true if queued, false if at limit.
export function queueExpense(uuid, payload) {
  if (!db) return false;
  purgeExpired();
  if (!canEnqueue().allowed) return false;

  run(
    `INSERT OR IGNORE INTO offline_expenses (uuid, payload, status, created_at)
     VALUES (?, ?, 'pending', ?);`,
    [uuid, JSON.stringify(payload), new Date().toISOString()]
  );
  return true;
}

// All pending (not yet synced, not rejected) expenses, oldest first.
export function getPendingExpenses() {
  if (!db) return [];
  return all(
    "SELECT * FROM offline_expenses WHERE status = 'pending' ORDER BY created_at ASC;"
  );
}

export function getPendingExpenseCount() {
  if (!db) return 0;
  const row = first("SELECT COUNT(*) as c FROM offline_expenses WHERE status = 'pending';");
  return row ? row.c : 0;
}

// Everything waiting to sync, all queues (for the offline banner).
export function getPendingCount() {
  return getPendingExpenseCount() + getPendingTaskUpdateCount() + getPendingScanCount();
}

// Mark a row as synced and record the timestamp.
export function markSynced(uuid) {
  if (!db) return;
  run(
    "UPDATE offline_expenses SET status = 'synced', synced_at = ? WHERE uuid = ?;",
    [new Date().toISOString(), uuid]
  );
}

// Mark a row as rejected (server said don't retry).
export function markRejected(uuid, code, message) {
  if (!db) return;
  run(
    "UPDATE offline_expenses SET status = 'rejected', reject_code = ?, reject_message = ? WHERE uuid = ?;",
    [code || "UNKNOWN", message || "Rejected by server", uuid]
  );
}

// Purge all synced rows (called after a successful sync batch).
export function purgeSynced() {
  if (!db) return;
  run("DELETE FROM offline_expenses WHERE status = 'synced';");
}

// Get rejected rows so the user can see what failed.
export function getRejectedExpenses() {
  if (!db) return [];
  return all(
    "SELECT * FROM offline_expenses WHERE status = 'rejected' ORDER BY created_at DESC;"
  );
}

// Clear a specific rejected row (user acknowledged it).
export function dismissRejected(uuid) {
  if (!db) return;
  run("DELETE FROM offline_expenses WHERE uuid = ? AND status = 'rejected';", [uuid]);
}

// ── task submissions (Site Manager) ──────────────────────────────────────────

// Queue one task submission. Returns
//   { queued: true,  replacedPhotoPath }  replacedPhotoPath is the file of the
//                                         older pending update for this task,
//                                         or null; the caller deletes that file.
//   { queued: false, reason, message }    the queue rule said no.
// photoPath is a file already copied into the app's documents folder.
export function queueTaskUpdate({ updateId, taskId, userId, photoPath, note }) {
  if (!db) return { queued: false, reason: "NO_DB", message: "Offline storage is not ready yet." };
  purgeExpired();

  const gate = canEnqueue({ replacingTaskId: taskId });
  if (!gate.allowed) return { queued: false, reason: gate.reason, message: gate.message };

  const older = first(
    "SELECT photo_path FROM offline_task_updates WHERE task_id = ? AND sync_status = 'PENDING';",
    [taskId]
  );

  // One transaction: if the app is killed half way, the old entry survives.
  // guarded() reruns the whole transaction if the connection had been closed.
  guarded((d) => {
    d.execSync("BEGIN;");
    try {
      d.runSync("DELETE FROM offline_task_updates WHERE task_id = ? AND sync_status = 'PENDING';", [taskId]);
      d.runSync(
        `INSERT INTO offline_task_updates
           (update_id, task_id, user_id, photo_path, note, created_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING');`,
        [updateId, taskId, userId, photoPath, note ?? null, new Date().toISOString()]
      );
      d.execSync("COMMIT;");
    } catch (error) {
      try {
        d.execSync("ROLLBACK;");
      } catch {
        // the connection itself is gone; nothing to roll back
      }
      throw error;
    }
  });
  return { queued: true, replacedPhotoPath: older ? older.photo_path : null };
}

export function getPendingTaskUpdateCount() {
  if (!db) return 0;
  const row = first("SELECT COUNT(*) as c FROM offline_task_updates WHERE sync_status = 'PENDING';");
  return row ? row.c : 0;
}

// Pending task submissions, oldest first. Pass userId so a phone shared by two
// people only ever sends each person's own entries.
/** @param {string | null} [userId] */
export function getPendingTaskUpdates(userId = null) {
  if (!db) return [];
  return all(
    `SELECT * FROM offline_task_updates
      WHERE sync_status = 'PENDING' AND (? IS NULL OR user_id = ?)
      ORDER BY created_at ASC;`,
    [userId, userId]
  );
}

// The pending submission for one task, if any (the task screen shows "queued").
export function getPendingTaskUpdateForTask(taskId) {
  if (!db) return null;
  return (
    first(
      "SELECT * FROM offline_task_updates WHERE task_id = ? AND sync_status = 'PENDING';",
      [taskId]
    ) ?? null
  );
}

// Remember the URL the photo upload returned, so a failed batch never uploads
// the same photo twice.
export function setTaskUpdatePhotoUrl(updateId, url) {
  if (!db) return;
  run("UPDATE offline_task_updates SET server_photo_url = ? WHERE update_id = ?;", [url, updateId]);
}

export function markTaskUpdateSynced(updateId) {
  if (!db) return;
  run("UPDATE offline_task_updates SET sync_status = 'SYNCED' WHERE update_id = ?;", [updateId]);
}

export function markTaskUpdateRejected(updateId, code, message) {
  if (!db) return;
  run(
    "UPDATE offline_task_updates SET sync_status = 'REJECTED', error_code = ?, error_message = ? WHERE update_id = ?;",
    [code || "UNKNOWN", message || "Rejected by server", updateId]
  );
}

// Delete synced rows; returns their photo paths so the caller can delete the files.
export function purgeSyncedTaskUpdates() {
  if (!db) return [];
  const paths = db
    .getAllSync("SELECT photo_path FROM offline_task_updates WHERE sync_status = 'SYNCED';")
    .map((row) => row.photo_path);
  run("DELETE FROM offline_task_updates WHERE sync_status = 'SYNCED';");
  return paths;
}

export function getRejectedTaskUpdates() {
  if (!db) return [];
  return all("SELECT * FROM offline_task_updates WHERE sync_status = 'REJECTED' ORDER BY created_at DESC;");
}

// The user has seen the rejection. Returns the photo path to delete, or null.
export function dismissRejectedTaskUpdate(updateId) {
  if (!db) return null;
  const row = first(
    "SELECT photo_path FROM offline_task_updates WHERE update_id = ? AND sync_status = 'REJECTED';",
    [updateId]
  );
  run("DELETE FROM offline_task_updates WHERE update_id = ? AND sync_status = 'REJECTED';", [updateId]);
  return row ? row.photo_path : null;
}


// ── small settings (the saved sign-in) ───────────────────────────────────────

export function kvGet(key) {
  if (!db) return null;
  const row = first("SELECT value FROM app_kv WHERE key = ?;", [key]);
  return row ? row.value : null;
}

export function kvSet(key, value) {
  if (!db) return;
  run("INSERT OR REPLACE INTO app_kv (key, value) VALUES (?, ?);", [key, value]);
}

export function kvDelete(key) {
  if (!db) return;
  run("DELETE FROM app_kv WHERE key = ?;", [key]);
}

// ── last-known server answers (read offline) ─────────────────────────────────
// One row per screen query per user, so a second person on the same phone
// never sees the first person's data.

export function cacheWrite(key, userId, data, savedAt = new Date().toISOString()) {
  if (!db) return;
  run(
    "INSERT OR REPLACE INTO api_cache (key, user_id, body, saved_at) VALUES (?, ?, ?, ?);",
    [key, userId, JSON.stringify(data), savedAt]
  );
}

// { data, savedAt } or null.
export function cacheRead(key, userId) {
  if (!db) return null;
  const row = first("SELECT body, saved_at FROM api_cache WHERE key = ? AND user_id = ?;", [key, userId]);
  return row ? { data: JSON.parse(row.body), savedAt: row.saved_at } : null;
}

// ── receipt photos waiting to be uploaded for reading ────────────────────────
// Reading a receipt (OCR) happens on the server, so offline the photo is saved
// here and uploaded on reconnect. The server then reads it in the background
// and it appears under "Scanned receipts" like any other scan.

// Returns { queued: true } or { queued: false, reason, message }.
export function queueScan({ scanId, userId, filePath, fileName, fileType, mimeType, context }) {
  if (!db) return { queued: false, reason: "NO_DB", message: "Offline storage is not ready yet." };
  purgeExpired();
  const gate = canEnqueue();
  if (!gate.allowed) return { queued: false, reason: gate.reason, message: gate.message };
  run(
    `INSERT INTO offline_scans
       (scan_id, user_id, file_path, file_name, file_type, mime_type, context, created_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING');`,
    [scanId, userId, filePath, fileName, fileType, mimeType, JSON.stringify(context), new Date().toISOString()]
  );
  return { queued: true };
}

export function getPendingScanCount() {
  if (!db) return 0;
  const row = first("SELECT COUNT(*) as c FROM offline_scans WHERE sync_status = 'PENDING';");
  return row ? row.c : 0;
}

// Pending scans for one user, oldest first; context is parsed back to an object.
/** @param {string | null} [userId] */
export function getPendingScans(userId = null) {
  if (!db) return [];
  return all(
    `SELECT * FROM offline_scans
      WHERE sync_status = 'PENDING' AND (? IS NULL OR user_id = ?)
      ORDER BY created_at ASC;`,
    [userId, userId]
  ).map((row) => ({ ...row, context: JSON.parse(row.context) }));
}

// Uploaded: the server has it now. Returns the local file path to delete.
export function markScanUploaded(scanId) {
  if (!db) return null;
  const row = first("SELECT file_path FROM offline_scans WHERE scan_id = ?;", [scanId]);
  run("DELETE FROM offline_scans WHERE scan_id = ?;", [scanId]);
  return row ? row.file_path : null;
}

export function markScanRejected(scanId, message) {
  if (!db) return;
  run(
    "UPDATE offline_scans SET sync_status = 'REJECTED', error_message = ? WHERE scan_id = ?;",
    [message || "The server could not accept this file.", scanId]
  );
}

/** @param {string | null} [userId] */
export function getRejectedScans(userId = null) {
  if (!db) return [];
  return all(
    `SELECT * FROM offline_scans
      WHERE sync_status = 'REJECTED' AND (? IS NULL OR user_id = ?)
      ORDER BY created_at DESC;`,
    [userId, userId]
  ).map((row) => ({ ...row, context: JSON.parse(row.context) }));
}

// The user removed a waiting or rejected scan. Returns the file path to delete.
export function removeQueuedScan(scanId) {
  if (!db) return null;
  const row = first("SELECT file_path FROM offline_scans WHERE scan_id = ?;", [scanId]);
  run("DELETE FROM offline_scans WHERE scan_id = ?;", [scanId]);
  return row ? row.file_path : null;
}
