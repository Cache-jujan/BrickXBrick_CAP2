// F10 — Push queued offline work to POST /api/sync.
//
// Two queues feed one batch: expenses (Purchaser) and task submissions
// (Site Manager). Order on reconnect:
//   1. for every pending task update with no server photo URL yet, upload its
//      photo (POST /api/tasks/:id/photo) and save the URL on the row, so a
//      failed batch never uploads the same photo twice;
//   2. send ONE batch: { items: [{ uuid, type: "expense" | "task_update", data }] }
//
// Response: { syncedIds: [...], rejected: [{ id, code, message }] }
//   - syncedIds  -> marked synced, then purged from SQLite (10.9)
//   - rejected   -> marked rejected, NOT retried (server wins, 10.7)
//   - an id in neither list (the server could not check something, e.g. photo
//     storage timed out) stays pending and goes again on the next sync
//   - network / 401 / 5xx on the batch -> throws, rows stay pending

import { API_URL, authHeaders } from "@/constants/api";
import { getSession } from "@/lib/auth";
import {
  getPendingExpenses,
  markSynced,
  markRejected,
  purgeSynced,
  getPendingTaskUpdates,
  setTaskUpdatePhotoUrl,
  markTaskUpdateSynced,
  markTaskUpdateRejected,
  purgeSyncedTaskUpdates,
} from "@/lib/sync/db";
import { PhotoUploadRejected, uploadTaskPhoto, deleteQueuedPhoto } from "@/lib/sync/task-photo";
import { devLog } from "@/lib/sync/log";

// Step 1 for the task updates: make sure each has a server photo URL.
// Returns the rows that are ready to be sent. A permanent refusal marks the row
// rejected; a temporary failure leaves it pending and out of this batch, and is
// reported in postponedItems so the screens can say "not sent yet".
async function uploadPendingPhotos(rows, upload) {
  const ready = [];
  const rejectedItems = [];
  const postponedItems = [];
  for (const row of rows) {
    if (row.server_photo_url) {
      ready.push(row);
      continue;
    }
    try {
      const url = await upload(row.task_id, row.photo_path);
      setTaskUpdatePhotoUrl(row.update_id, url);
      ready.push({ ...row, server_photo_url: url });
    } catch (error) {
      if (error instanceof PhotoUploadRejected) {
        markTaskUpdateRejected(row.update_id, error.code, error.message);
        rejectedItems.push({ kind: "task_update", id: row.update_id, code: error.code, message: error.message });
      } else {
        devLog("[F10 sync] photo upload postponed:", error?.message ?? error);
        postponedItems.push({ kind: "task_update", id: row.update_id, message: error?.message ?? String(error) });
      }
    }
  }
  return { ready, rejectedItems, postponedItems };
}

// Returns { synced, rejected, expenses: {synced, rejected}, tasks: {synced, rejected},
//           rejectedItems: [{ kind, id, code, message }],
//           postponedItems: [{ kind, id, message }] }  (not sent yet, will retry)
// Throws if the batch request itself fails. `deps` is for tests.
export async function syncAllPending(deps = {}) {
  const upload = deps.uploadTaskPhoto || uploadTaskPhoto;
  const removeFile = deps.deleteQueuedPhoto || deleteQueuedPhoto;
  const session = (deps.getSession || getSession)();

  const result = {
    synced: 0,
    rejected: 0,
    expenses: { synced: 0, rejected: 0 },
    tasks: { synced: 0, rejected: 0 },
    rejectedItems: [],
    postponedItems: [],
  };
  if (!session) return result; // signed out: nothing may be sent under another identity

  // One phone, possibly two people over time: each role sends only its own kind.
  const role = session.user.role;
  const expenseRows = role === "Purchaser" ? getPendingExpenses() : [];
  const taskRows = role === "Site Manager" ? getPendingTaskUpdates(session.user.id) : [];

  const photos = await uploadPendingPhotos(taskRows, upload);
  result.tasks.rejected += photos.rejectedItems.length;
  result.rejectedItems.push(...photos.rejectedItems);
  result.postponedItems.push(...photos.postponedItems);

  const items = [
    ...expenseRows.map((row) => ({ uuid: row.uuid, type: "expense", data: JSON.parse(row.payload) })),
    ...photos.ready.map((row) => ({
      uuid: row.update_id,
      type: "task_update",
      data: { taskId: row.task_id, photoUrl: row.server_photo_url, ...(row.note ? { note: row.note } : {}) },
    })),
  ];

  if (items.length > 0) {
    const res = await fetch(`${API_URL}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) throw new Error(`Sync failed: ${res.status}`);

    const body = await res.json();
    const syncedIds = body.syncedIds ?? [];
    const rejected = body.rejected ?? [];
    const expenseIds = new Set(expenseRows.map((row) => row.uuid));
    const taskIds = new Set(photos.ready.map((row) => row.update_id));

    for (const id of syncedIds) {
      if (expenseIds.has(id)) {
        markSynced(id);
        result.expenses.synced += 1;
      } else if (taskIds.has(id)) {
        markTaskUpdateSynced(id);
        result.tasks.synced += 1;
      }
    }
    const answered = new Set([...syncedIds, ...rejected.map((r) => r.id)]);
    for (const row of photos.ready) {
      if (!answered.has(row.update_id)) {
        result.postponedItems.push({ kind: "task_update", id: row.update_id, message: "The server could not check this update yet." });
      }
    }
    for (const r of rejected) {
      if (expenseIds.has(r.id)) {
        markRejected(r.id, r.code, r.message);
        result.expenses.rejected += 1;
        result.rejectedItems.push({ kind: "expense", id: r.id, code: r.code, message: r.message });
      } else if (taskIds.has(r.id)) {
        markTaskUpdateRejected(r.id, r.code, r.message);
        result.tasks.rejected += 1;
        result.rejectedItems.push({ kind: "task_update", id: r.id, code: r.code, message: r.message });
      }
    }
  }

  purgeSynced();
  for (const path of purgeSyncedTaskUpdates()) await removeFile(path);

  result.synced = result.expenses.synced + result.tasks.synced;
  result.rejected = result.expenses.rejected + result.tasks.rejected;
  return result;
}
