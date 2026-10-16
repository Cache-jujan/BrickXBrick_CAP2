// Test stand-in for "expo-sqlite", backed by Node's built-in SQLite
// (node:sqlite). It offers only the calls lib/sync/db.js uses. Opening the same
// name twice returns the same database, like reopening the app's file.
import { DatabaseSync } from "node:sqlite";

const open = new Map();

export function openDatabaseSync(name) {
  if (!open.has(name)) open.set(name, new DatabaseSync(":memory:"));
  const raw = open.get(name);
  return {
    execSync: (sql) => raw.exec(sql),
    runSync: (sql, params = []) => raw.prepare(sql).run(...params),
    getFirstSync: (sql, params = []) => raw.prepare(sql).get(...params) ?? null,
    getAllSync: (sql, params = []) => raw.prepare(sql).all(...params),
  };
}

// Tests only: forget every database (a fresh phone) or reach into one.
export function resetShim() {
  for (const raw of open.values()) raw.close();
  open.clear();
}
export function rawDb(name = "offline_queue.db") {
  return open.get(name);
}
