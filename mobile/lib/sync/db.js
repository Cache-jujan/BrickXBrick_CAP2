// F10 — Offline expense queue (SQLite).
//
// Stores expense payloads captured while the device is offline. Each row
// carries a client-generated UUID for idempotency (the server's synced_actions
// table deduplicates on it). Rows older than 72 hours or beyond 100 pending
// are rejected at insert time — the user must be online to submit those.
//
// Status lifecycle: pending → synced  (purged after sync)
//                          → rejected (kept so the user sees the reason)

import * as SQLite from "expo-sqlite";

const DB_NAME = "offline_queue.db";
const MAX_PENDING = 100;
const MAX_AGE_MS = 72 * 60 * 60 * 1000; // 72 hours

let db = null;

export function initDb() {
  db = SQLite.openDatabaseSync(DB_NAME);
  db.execSync(`
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
  // Purge anything older than 72 hours on startup.
  purgeExpired();
}

// Purge rows older than 72 hours (pending or rejected).
export function purgeExpired() {
  if (!db) return;
  const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString();
  db.runSync("DELETE FROM offline_expenses WHERE created_at < ?;", [cutoff]);
}

// Queue one expense for later sync. Returns true if queued, false if at limit.
export function queueExpense(uuid, payload) {
  if (!db) return false;
  purgeExpired();
  const count = db.getFirstSync(
    "SELECT COUNT(*) as c FROM offline_expenses WHERE status = 'pending';"
  );
  if (count && count.c >= MAX_PENDING) return false;

  db.runSync(
    `INSERT OR IGNORE INTO offline_expenses (uuid, payload, status, created_at)
     VALUES (?, ?, 'pending', ?);`,
    [uuid, JSON.stringify(payload), new Date().toISOString()]
  );
  return true;
}

// All pending (not yet synced, not rejected) expenses, oldest first.
export function getPendingExpenses() {
  if (!db) return [];
  return db.getAllSync(
    "SELECT * FROM offline_expenses WHERE status = 'pending' ORDER BY created_at ASC;"
  );
}

// Count of pending expenses (for the offline banner).
export function getPendingCount() {
  if (!db) return 0;
  const row = db.getFirstSync(
    "SELECT COUNT(*) as c FROM offline_expenses WHERE status = 'pending';"
  );
  return row ? row.c : 0;
}

// Mark a row as synced and record the timestamp.
export function markSynced(uuid) {
  if (!db) return;
  db.runSync(
    "UPDATE offline_expenses SET status = 'synced', synced_at = ? WHERE uuid = ?;",
    [new Date().toISOString(), uuid]
  );
}

// Mark a row as rejected (server said don't retry).
export function markRejected(uuid, code, message) {
  if (!db) return;
  db.runSync(
    "UPDATE offline_expenses SET status = 'rejected', reject_code = ?, reject_message = ? WHERE uuid = ?;",
    [code || "UNKNOWN", message || "Rejected by server", uuid]
  );
}

// Purge all synced rows (called after a successful sync batch).
export function purgeSynced() {
  if (!db) return;
  db.runSync("DELETE FROM offline_expenses WHERE status = 'synced';");
}

// Get rejected rows so the user can see what failed.
export function getRejectedExpenses() {
  if (!db) return [];
  return db.getAllSync(
    "SELECT * FROM offline_expenses WHERE status = 'rejected' ORDER BY created_at DESC;"
  );
}

// Clear a specific rejected row (user acknowledged it).
export function dismissRejected(uuid) {
  if (!db) return;
  db.runSync("DELETE FROM offline_expenses WHERE uuid = ? AND status = 'rejected';", [uuid]);
}