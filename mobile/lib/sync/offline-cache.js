// Offline-first reads: "network first, fall back to the last saved answer".
//
// Every screen that loads data from the server goes through withCache. When
// the request works, the answer is saved on the phone (api_cache). When the
// phone is offline or the server can't be reached, the last saved answer is
// returned instead, with the time it was saved, so the screen can say
// "Offline · showing your work as of 10:42 AM". Real server refusals (403,
// 404, validation) are never hidden behind old data.

import { cacheRead, cacheWrite } from "@/lib/sync/db";
import { isNetworkError } from "@/lib/sync/messages";

// Kept in step with the phone's connection by network-context.js. When we
// already know we're offline, we skip the request and go straight to the
// saved copy (no 10-second wait for a request that can't work).
let online = true;
export function setCacheOnline(value) {
  online = !!value;
}

/**
 * withCache(key, userId, load) -> { data, fromCache, savedAt }
 *   key     a stable name for the query, e.g. "tasks:assigned"
 *   userId  whose data it is (the cache is per user)
 *   load    async () => data, the real request
 * Throws only when there is neither a server answer nor a saved copy, or when
 * the server answered with a real error (not a connection problem).
 */
export async function withCache(key, userId, load, deps = {}) {
  const read = deps.cacheRead || cacheRead;
  const write = deps.cacheWrite || cacheWrite;
  const isOnline = deps.isOnline ?? online;

  if (isOnline) {
    try {
      const data = await load();
      const savedAt = new Date().toISOString();
      if (userId) write(key, userId, data, savedAt);
      return { data, fromCache: false, savedAt };
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      const saved = userId ? read(key, userId) : null;
      if (!saved) throw error;
      return { data: saved.data, fromCache: true, savedAt: saved.savedAt };
    }
  }

  const saved = userId ? read(key, userId) : null;
  if (saved) return { data: saved.data, fromCache: true, savedAt: saved.savedAt };
  const error = new Error("Network request failed: offline and nothing saved on this phone yet");
  error.offlineNoCache = true;
  throw error;
}

const TIME = { hour: "numeric", minute: "2-digit" };

// "Offline · showing your work as of 10:42 AM" (or with the date if older).
export function savedAtLabel(savedAt, now = new Date()) {
  if (!savedAt) return "";
  const d = new Date(savedAt);
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], TIME);
  return sameDay ? `as of ${time}` : `as of ${d.toLocaleDateString()} ${time}`;
}
