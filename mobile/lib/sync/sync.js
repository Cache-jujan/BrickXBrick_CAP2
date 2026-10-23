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
//   - network / 5xx on the batch -> throws, rows stay pending
//   - 401 (the sign-in token was refused) -> syncAllPending refreshes the sign-in
//     and runs again once; if it cannot, it signs out (queue kept) or, when the
//     refresh could not be tried (no connection), just stops and tries later

import { API_URL, authHeaders } from "@/constants/api";
import { ensureFreshToken, getSession, handleUnauthorized, refreshSession } from "@/lib/auth";
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
  getPendingScans,
  markScanUploaded,
  markScanRejected,
} from "@/lib/sync/db";
import { PhotoUploadRejected, uploadTaskPhoto, uploadQueuedScan, deleteQueuedPhoto } from "@/lib/sync/task-photo";
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
      if (error?.unauthorized) throw error; // stop: syncAllPending decides what a refused sign-in means
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

// Step 0 for receipts saved offline: upload each one for reading. The server
// reads it in the background and it shows up under "Scanned receipts".
async function uploadQueuedScans(rows, upload, removeFile, result) {
  for (const row of rows) {
    try {
      await upload(row);
      const path = markScanUploaded(row.scan_id);
      await removeFile(path);
      result.scans.uploaded += 1;
    } catch (error) {
      if (error?.unauthorized) throw error; // stop: syncAllPending decides what a refused sign-in means
      if (error instanceof PhotoUploadRejected) {
        markScanRejected(row.scan_id, error.message);
        result.scans.rejected += 1;
        result.rejectedItems.push({ kind: "scan", id: row.scan_id, code: error.code, message: error.message });
      } else {
        devLog("[F10 sync] receipt upload postponed:", error?.message ?? error);
        result.postponedItems.push({ kind: "scan", id: row.scan_id, message: error?.message ?? String(error) });
      }
    }
  }
}

function unauthorizedError() {
  const error = new Error("Sign-in expired");
  // @ts-ignore: a flag the callers look for, same as in task-photo.js
  error.unauthorized = true;
  return error;
}

// One pass over everything queued. Throws an error with unauthorized = true as
// soon as the server refuses the sign-in token (the rows stay pending).
async function syncOnce(deps) {
  const upload = deps.uploadTaskPhoto || uploadTaskPhoto;
  const uploadScan = deps.uploadQueuedScan || uploadQueuedScan;
  const removeFile = deps.deleteQueuedPhoto || deleteQueuedPhoto;
  const session = (deps.getSession || getSession)();

  const result = {
    synced: 0,
    rejected: 0,
    expenses: { synced: 0, rejected: 0 },
    tasks: { synced: 0, rejected: 0 },
    scans: { uploaded: 0, rejected: 0 },
    rejectedItems: [],
    postponedItems: [],
  };
  if (!session) return result; // signed out: nothing may be sent under another identity

  // Receipts saved offline go first (any mobile role may scan receipts).
  await uploadQueuedScans(getPendingScans(session.user.id), uploadScan, removeFile, result);

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
    if (res.status === 401) throw unauthorizedError(); // the sign-in token was refused; queue is kept
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

  result.synced = result.expenses.synced + result.tasks.synced + result.scans.uploaded;
  result.rejected = result.expenses.rejected + result.tasks.rejected + result.scans.rejected;
  return result;
}

// Returns { synced, rejected, expenses: {synced, rejected}, tasks: {synced, rejected},
//           scans: {uploaded, rejected},
//           rejectedItems: [{ kind, id, code, message }],
//           postponedItems: [{ kind, id, message }] }  (not sent yet, will retry)
// Throws if the batch request itself fails. `deps` is for tests.
//
// A refused sign-in token (401) is not the end: the phone holds a refresh token,
// so it gets a new sign-in token and runs the pass once more. Only when the
// server says the sign-in is really over does the person go back to the sign-in
// screen (their queue stays). If the refresh could not be tried (no connection),
// nobody is signed out: the rows stay queued and the next run tries again.
export async function syncAllPending(deps = {}) {
  const ensureFresh = deps.ensureFreshToken || ensureFreshToken;
  const refresh = deps.refreshSession || refreshSession;
  const signOut = deps.handleUnauthorized || handleUnauthorized;

  await ensureFresh();
  try {
    return await syncOnce(deps);
  } catch (error) {
    if (!error?.unauthorized) throw error;
    const outcome = await refresh();
    if (outcome === "refreshed") {
      try {
        return await syncOnce(deps);
      } catch (again) {
        if (again?.unauthorized) signOut(); // refreshed and still refused: over
        throw again;
      }
    }
    if (outcome !== "later") signOut(); // "rejected" or "unavailable": sign in again
    throw error;
  }
}
