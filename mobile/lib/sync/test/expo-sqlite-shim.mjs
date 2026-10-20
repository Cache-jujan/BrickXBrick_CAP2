// Test stand-in for "expo-sqlite", backed by Node's built-in SQLite
// (node:sqlite). It offers only the calls lib/sync/db.js uses.
//
// Like the real module, opening the same name again shares ONE connection,
// and a test can "close" that shared connection (breakConnections) to
// reproduce the phone crash: every call then throws the same error Android
// gave ("NativeDatabase.prepareSync ... NullPointerException").
// { useNewConnection: true } opens a fresh, working handle on the same data.
import { DatabaseSync } from "node:sqlite";

const raws = new Map(); // name -> DatabaseSync (the data)
const handles = []; // every handle given out
export const stats = { opens: 0, lastOptions: null };

const NPE = "Call to function 'NativeDatabase.prepareSync' has been rejected.\n→ Caused by: java.lang.NullPointerException";

export function openDatabaseSync(name, options = {}) {
  stats.opens += 1;
  stats.lastOptions = options;
  if (!raws.has(name)) raws.set(name, new DatabaseSync(":memory:"));
  const raw = raws.get(name);
  const handle = { broken: false };
  const guard = (fn) => (...args) => {
    if (handle.broken) throw new Error(NPE);
    return fn(...args);
  };
  Object.assign(handle, {
    execSync: guard((sql) => raw.exec(sql)),
    runSync: guard((sql, params = []) => raw.prepare(sql).run(...params)),
    getFirstSync: guard((sql, params = []) => raw.prepare(sql).get(...params) ?? null),
    getAllSync: guard((sql, params = []) => raw.prepare(sql).all(...params)),
  });
  handles.push(handle);
  return handle;
}

// The shared connection was closed under the app's feet.
export function breakConnections() {
  for (const handle of handles) handle.broken = true;
}

// Tests only: a fresh phone. Drops every table but keeps the database (and the
// app's handle) open, because db.js opens once and never reopens.
export function resetShim() {
  for (const raw of raws.values()) {
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    for (const { name } of tables) raw.exec(`DROP TABLE IF EXISTS "${name}"`);
  }
  for (const handle of handles) handle.broken = false;
  stats.opens = 0;
  stats.lastOptions = null;
}

export function rawDb(name = "offline_queue.db") {
  return raws.get(name);
}
