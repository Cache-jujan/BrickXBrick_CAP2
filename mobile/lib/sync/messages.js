// F10 — plain-language text for sync results. Pure (no React, no database), so
// the wording rules can be tested.

// Server reject codes a Site Manager can see on a task update, in words a
// person on a construction site understands. TASK_NOT_YOURS, TASK_CLOSED and
// SUPERSEDED are the three they will actually meet.
const TASK_REASONS = {
  TASK_NOT_YOURS: "This task was reassigned to someone else, so your update was not sent.",
  TASK_CLOSED: "This task was already completed, so your update was not needed.",
  SUPERSEDED: "Your Project Manager already has a submission for this task waiting for review.",
  TASK_NOT_FOUND: "This task no longer exists.",
  PROJECT_NOT_ACTIVE: "This project is no longer active, so updates can't be added.",
  MISSING_PHOTO: "The photo could not be used. Please take a new one and submit again.",
  WRONG_ROLE: "This account can't send task updates.",
  DUPLICATE_UUID: "This update was already sent from another device.",
  INVALID_FIELDS: "This update was not valid. Please submit it again.",
};

// Daily check-in rejections (kind "daily_checkin").
const CHECKIN_REASONS = {
  DUPLICATE_CHECKIN: "A check-in for this slot was already sent, so this one was not needed.",
  TOO_OLD: "This check-in was saved more than 3 days ago and can no longer be sent.",
  NOT_YOUR_PROJECT: "You are no longer the Site Manager of this project, so the check-in was not sent.",
  PROJECT_NOT_FOUND: "This project no longer exists.",
  PROJECT_NOT_ACTIVE: "This project is no longer active, so check-ins can't be added.",
  TASK_NOT_FOUND: "A task you linked is no longer assigned to you, so the check-in was not sent.",
  MISSING_PHOTO: "A photo could not be used. Please make the check-in again.",
  DUPLICATE_UUID: "This check-in was already sent from another device.",
  INVALID_FIELDS: "This check-in was not valid. Please make it again.",
  WRONG_ROLE: "This account can't send check-ins.",
};

export function describeCheckinRejection(code, serverMessage) {
  return CHECKIN_REASONS[code] || serverMessage || "The server could not accept this check-in.";
}

// The text to show for a rejected task update. Unknown codes fall back to the
// server's own message.
export function describeRejection(code, serverMessage) {
  return TASK_REASONS[code] || serverMessage || "The server could not accept this update.";
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const MAX_REASONS = 3;

/**
 * One message per sync run (10.8). `result` is what syncAllPending returns:
 *   { synced, rejected, expenses: {synced, rejected}, tasks: {synced, rejected},
 *     rejectedItems: [{ kind: "expense" | "task_update", code, message }] }
 * Returns { title, message } or null when nothing happened (no alert at all).
 */
export function buildSyncSummary(result) {
  if (!result || (result.synced === 0 && result.rejected === 0)) return null;

  const lines = [];
  if (result.expenses.synced > 0) lines.push(`${plural(result.expenses.synced, "expense", "expenses")} synced`);
  if (result.tasks.synced > 0) lines.push(`${plural(result.tasks.synced, "task update", "task updates")} sent for review`);
  if (result.checkins?.synced > 0) lines.push(`${plural(result.checkins.synced, "check-in", "check-ins")} sent`);
  if (result.scans?.uploaded > 0) {
    lines.push(`${plural(result.scans.uploaded, "receipt", "receipts")} uploaded for reading (see Scanned receipts)`);
  }

  if (result.rejected > 0) {
    lines.push(`${result.rejected} not synced`);
    const reasons = (result.rejectedItems || []).slice(0, MAX_REASONS).map((item) =>
      item.kind === "task_update"
        ? `• ${describeRejection(item.code, item.message)}`
        : item.kind === "daily_checkin"
          ? `• ${describeCheckinRejection(item.code, item.message)}`
          : item.kind === "scan"
          ? `• Receipt photo: ${item.message}`
          : `• ${item.code}: ${item.message}`
    );
    lines.push(...reasons);
    const more = result.rejected - reasons.length;
    if (more > 0) lines.push(`• and ${more} more`);
  }
  return { title: "Sync complete", message: lines.join("\n") };
}

// ---- loading errors -------------------------------------------------------------

// iOS says "Network request failed"; Android (expo/fetch, OkHttp) says things like
// "fetch failed: java.net.SocketException: Connection reset"; browsers say
// "Failed to fetch". All of them mean "couldn't reach the server".
const NETWORK_ERROR = new RegExp(
  [
    "network request failed",
    "failed to fetch",
    "fetch failed",
    "network ?error",
    "timed? ?out",
    "unreachable",
    "could not connect",
    "connection (reset|refused|abort|closed)",
    "socket ?exception",
    "connect ?exception",
    "unknown ?host",
    "socket ?timeout",
    "econn",
    "enotfound",
  ].join("|"),
  "i"
);

export function isNetworkError(error) {
  const message = typeof error === "string" ? error : error?.message ?? "";
  return NETWORK_ERROR.test(message);
}

/**
 * What a screen should show when loading from the server failed.
 * - Offline: nothing. The red banner already says so, and the screen keeps
 *   whatever it loaded last.
 * - Online, but the server can't be reached: one plain sentence, never the raw
 *   "Network request failed".
 * - Anything else: the server's own message.
 */
export function describeLoadError(error, isOnline) {
  if (!error || !isOnline) return null;
  if (isNetworkError(error)) return "Can't reach the server right now. Pull down to try again.";
  return typeof error === "string" ? error : error.message || "Something went wrong.";
}

/**
 * The message for a failed ACTION (submit, save): a connection problem becomes
 * one plain sentence; anything else keeps the server's own message.
 */
export function plainError(error, fallback) {
  if (isNetworkError(error)) return "Can't reach the server. Check your connection and try again.";
  if (error instanceof Error && error.message) return error.message;
  return typeof error === "string" && error ? error : fallback;
}

// ---- the status strip at the top of the app -------------------------------------

export const SENT_SHOW_MS = 5000;

/**
 * Which strip to show, or null for none.
 *   offline  red    no connection (with the queued count)
 *   waiting  amber  we tried and something is still queued (will retry)
 *   sending  blue   back online and a sync is running
 *   sent     green  a sync just sent everything (shown for SENT_SHOW_MS)
 * lastSync: { at, result } or { at, error } from the last sync run.
 */
export function bannerState({ isOnline, pendingCount, syncing, lastSync, now = Date.now() }) {
  if (!isOnline) {
    return { tone: "offline", text: pendingCount > 0 ? `You're offline · ${pendingCount} queued` : "You're offline" };
  }
  const stuck = !!lastSync && (!!lastSync.error || (lastSync.result?.postponedItems?.length ?? 0) > 0);
  if (pendingCount > 0 && stuck) {
    return { tone: "waiting", text: `${plural(pendingCount, "update", "updates")} waiting to send · will retry automatically` };
  }
  if (pendingCount > 0 && syncing) {
    return { tone: "sending", text: `Back online · sending ${pendingCount} queued…` };
  }
  const sent = lastSync?.result?.synced ?? 0;
  if (sent > 0 && pendingCount === 0 && now - lastSync.at < SENT_SHOW_MS) {
    return { tone: "sent", text: `All caught up · ${plural(sent, "update", "updates")} sent` };
  }
  return null;
}