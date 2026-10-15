// F10 — Push queued offline expenses to POST /api/sync.
//
// One batch request: { items: [{ uuid, type: "expense", data }] }
// Response:          { syncedIds: [...], rejected: [{ id, code, message }] }
//
// - syncedIds  -> marked synced, then purged from SQLite (10.9)
// - rejected   -> marked rejected, NOT retried (server wins, 10.7)
// - network / 401 / 5xx -> throws, rows stay 'pending' and retry on next reconnect

import { API_URL, authHeaders } from "@/constants/api";
import {
  getPendingExpenses,
  markSynced,
  markRejected,
  purgeSynced,
} from "@/lib/sync/db";

// Returns { synced, rejected } counts. Throws if the request itself fails.
export async function syncAllPending() {
  const pending = getPendingExpenses();
  if (pending.length === 0) return { synced: 0, rejected: 0 };

  const items = pending.map((row) => ({
    uuid: row.uuid,
    type: "expense",
    data: JSON.parse(row.payload),
  }));

  const res = await fetch(`${API_URL}/api/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ items }),
  });

  if (!res.ok) throw new Error(`Sync failed: ${res.status}`);

  const body = await res.json();
  const syncedIds = body.syncedIds ?? [];
  const rejected = body.rejected ?? [];

  for (const id of syncedIds) markSynced(id);
  for (const r of rejected) markRejected(r.id, r.code, r.message);
  purgeSynced();

  return { synced: syncedIds.length, rejected: rejected.length };
}