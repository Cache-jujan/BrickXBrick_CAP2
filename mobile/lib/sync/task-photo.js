// F10 — the phone-side photo helpers for queued task submissions.
//
// A queued update cannot carry its photo inside the JSON sync batch, so on
// reconnect each photo is uploaded first (POST /api/tasks/:id/photo) and the
// batch carries only the URL that comes back.

import * as FileSystem from "expo-file-system/legacy";

import { API_URL, authHeaders } from "@/constants/api";

// The server said no for a reason that will not change by retrying (not your
// task, task closed, bad photo). The sync turns this into a REJECTED row.
export class PhotoUploadRejected extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const mimeFromPath = (path) => (/\.png$/i.test(path) ? "image/png" : "image/jpeg");

// Why a 4xx from the photo route is permanent, in the sync's reject vocabulary.
const REJECT_CODE_BY_STATUS = { 400: "MISSING_PHOTO", 403: "TASK_NOT_YOURS", 404: "TASK_NOT_FOUND", 409: "TASK_CLOSED" };

/**
 * Upload one queued photo. Returns the server URL.
 * Throws PhotoUploadRejected when retrying cannot help; throws a plain Error on
 * anything temporary (no network, 5xx, signed out), so the entry stays pending.
 */
export async function uploadTaskPhoto(taskId, photoPath) {
  const info = await FileSystem.getInfoAsync(photoPath);
  if (!info.exists) {
    throw new PhotoUploadRejected("MISSING_PHOTO", "The photo file is no longer on this phone.");
  }

  const result = await FileSystem.uploadAsync(`${API_URL}/api/tasks/${taskId}/photo`, photoPath, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "photo",
    mimeType: mimeFromPath(photoPath),
    headers: authHeaders(),
  });

  let body = {};
  try {
    body = JSON.parse(result.body || "{}");
  } catch {
    // a non-JSON error page; the status below decides
  }

  if (result.status >= 200 && result.status < 300 && body.photoUrl) return body.photoUrl;

  const code = REJECT_CODE_BY_STATUS[result.status];
  if (code) throw new PhotoUploadRejected(code, body.error || `Photo upload refused (${result.status})`);
  throw new Error(`Photo upload failed (${result.status})`); // 401, 5xx...: try again later
}

// Best effort: a file that is already gone is not an error.
export async function deleteQueuedPhoto(path) {
  if (!path) return;
  try {
    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch (error) {
    console.warn("[F10] could not delete queued photo:", error?.message ?? error);
  }
}
