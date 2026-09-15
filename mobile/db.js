import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('sync_spike.db');

export function initDb() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS sync_test_records (
      id TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
}

export function insertRecord(id, payload) {
  db.runSync(
    'INSERT INTO sync_test_records (id, payload, synced, created_at) VALUES (?, ?, 0, ?);',
    [id, payload, new Date().toISOString()]
  );
}

export function getAllRecords() {
  return db.getAllSync('SELECT * FROM sync_test_records ORDER BY created_at DESC;');
}

export function getUnsyncedRecords() {
  return db.getAllSync('SELECT * FROM sync_test_records WHERE synced = 0 ORDER BY created_at ASC;');
}

export function markSynced(id) {
  db.runSync('UPDATE sync_test_records SET synced = 1 WHERE id = ?;', [id]);
}