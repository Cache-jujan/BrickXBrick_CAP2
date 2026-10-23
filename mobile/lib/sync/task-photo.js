// F10 — the phone-side photo helpers for queued task submissions.
//
// A queued update cannot carry its photo inside the JSON sync batch, so on
// reconnect each photo is uploaded first (POST /api/tasks/:id/photo) and the
// batch carries only the URL that comes back.

import * as FileSystem from "expo-file-system/legacy";

import { API_URL, authHeaders } from "@/constants/api";
import { devLog } from "@/lib/sync/log";

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
 * anything temporary (no network, 5xx), so the entry stays pending. An expired
 * sign-in (401) throws an Error with unauthorized = true; the entry also stays
 * pending, but the sync stops and sends the user to sign in again.
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

  // The saved sign-in has expired. Retrying with the same token can never work,
  // so say so: the sync signs the user out and they sign in again, instead of
  // the update waiting "to retry" for ever.
  if (result.status === 401) {
    const error = new Error("Sign-in expired");
    error.unauthorized = true;
    throw error;
  }

  // A submission is already waiting for the PM's review (409 AWAITING_REVIEW).
  const code = body.details?.code === "AWAITING_REVIEW" ? "SUPERSEDED" : REJECT_CODE_BY_STATUS[result.status];
  if (code) throw new PhotoUploadRejected(code, body.error || `Photo upload refused (${result.status})`);
  throw new Error(`Photo upload failed (${result.status})`); // 401, 5xx...: try again later
}

// Best effort: a file that is already gone is not an error.
export async function deleteQueuedPhoto(path) {
  if (!path) return;
  try {
    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch (error) {
    devLog("[F10] could not delete queued photo:", error?.message ?? error);
  }
}

// The camera hands back a file in the cache folder, which the phone may clear
// at any time. Copy it into the app's documents folder (kept until we delete
// it) and return that path. The queue stores this path, never the image bytes.
export async function copyPhotoToQueue(sourceUri) {
  const dir = `${FileSystem.documentDirectory}task-photos/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {}); // already there
  const ext = /\.png$/i.test(sourceUri) ? "png" : "jpg";
  const target = `${dir}${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: target });
  return target;
}

// Any picked file (photo or PDF) into the app's documents folder, for the
// offline receipt queue. Same reasoning as copyPhotoToQueue: the original may
// sit in a cache folder the phone can clear.
export async function copyFileToQueue(sourceUri, fileName = "") {
  const dir = `${FileSystem.documentDirectory}queued-receipts/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {}); // already there
  const name = fileName || sourceUri;
  const ext = /\.pdf$/i.test(name) ? "pdf" : /\.png$/i.test(name) ? "png" : "jpg";
  const target = `${dir}${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: target });
  return target;
}

// Upload one queued receipt for reading (POST /api/receipts/scans, the same
// route the online "Scan receipt" button uses). Returns the server's scan.
// Throws PhotoUploadRejected when retrying cannot help (bad or missing file),
// a plain Error on anything temporary (no network, 5xx), so it stays queued.
export async function uploadQueuedScan(row) {
  const info = await FileSystem.getInfoAsync(row.file_path);
  if (!info.exists) {
    throw new PhotoUploadRejected("MISSING_FILE", "The receipt file is no longer on this phone. Please capture it again.");
  }
  const result = await FileSystem.uploadAsync(`${API_URL}/api/receipts/scans`, row.file_path, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "file",
    mimeType: row.mime_type,
    parameters: { context: JSON.stringify(row.context) },
    headers: authHeaders(),
  });
  let body = {};
  try {
    body = JSON.parse(result.body || "{}");
  } catch {
    // a non-JSON error page; the status below decides
  }
  if (result.status >= 200 && result.status < 300) return body;
  if (result.status === 401) {
    const error = new Error("Sign-in expired");
    error.unauthorized = true;
    throw error;
  }
  if (result.status === 400 || result.status === 413 || result.status === 415) {
    throw new PhotoUploadRejected("BAD_FILE", body.error || "The server could not read this file. Please capture the receipt again.");
  }
  throw new Error(`Receipt upload failed (${result.status})`); // 429, 5xx...: try again later
}
