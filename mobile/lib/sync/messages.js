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

  if (result.rejected > 0) {
    lines.push(`${result.rejected} not synced`);
    const reasons = (result.rejectedItems || []).slice(0, MAX_REASONS).map((item) =>
      item.kind === "task_update"
        ? `• ${describeRejection(item.code, item.message)}`
        : `• ${item.code}: ${item.message}`
    );
    lines.push(...reasons);
    const more = result.rejected - reasons.length;
    if (more > 0) lines.push(`• and ${more} more`);
  }
  return { title: "Sync complete", message: lines.join("\n") };
}

// ---- loading errors -------------------------------------------------------------

const NETWORK_ERROR = /network request failed|failed to fetch|network ?error|timed? ?out|unreachable|could not connect|econn|enotfound/i;

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
