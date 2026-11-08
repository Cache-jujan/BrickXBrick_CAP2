// Daily progress check-ins — the pure rules the phone applies before saving
// one (no React, no database), so they can be tested. The server checks the
// same things again; this only saves the Site Manager a failed round trip.

export const SLOTS = ["Morning", "Midday", "EndOfDay"];
/** @type {Record<"Morning" | "Midday" | "EndOfDay", string>} */
export const SLOT_LABEL = { Morning: "Morning", Midday: "Midday", EndOfDay: "End of day" };
export const SITE_STATUSES = ["On Track", "Delayed", "Blocked"];
export const MAX_PHOTOS = 3;
export const MAX_LINKED_TASKS = 20;
export const MAX_TEXT = 2000;

// The Philippine calendar day (UTC+8, no daylight saving) of a moment. A check-in
// belongs to the day it was made there, whatever the phone's own time zone says.
export function manilaDate(when = new Date()) {
  return new Date(new Date(when).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// What is still missing, in plain words ([] = ready to save).
/**
 * @param {{
 *   projectId: string | null, slot: string | null, siteStatus: string | null,
 *   summary?: string | null, issues?: string | null, needsPmAction?: boolean,
 *   taskIds?: string[], photoCount?: number,
 * }} input
 * @param {(key: string, values?: Record<string, string | number>) => string} [t]
 *   Translate function from useLocale. Without it the messages are English.
 * @returns {string[]}
 */
export function checkinProblems({ projectId, slot, siteStatus, summary, issues, needsPmAction, taskIds = [], photoCount = 0 }, t) {
  /** @type {(key: string, english: string, values?: Record<string, string | number>) => string} */
  const say = (key, english, values) => (t ? t(key, values) : english);
  /** @type {string[]} */
  const problems = [];
  if (!projectId) problems.push(say("ci.p_project", "Choose a project."));
  if (!SLOTS.includes(slot)) problems.push(say("ci.p_slot", "Choose Morning, Midday or End of day."));
  if (!SITE_STATUSES.includes(siteStatus)) problems.push(say("ci.p_status", "Choose how the site is going: On Track, Delayed or Blocked."));
  const text = (summary ?? "").trim();
  if (!text) problems.push(say("ci.p_summary", "Write a short summary of the site."));
  else if (text.length > MAX_TEXT) problems.push(say("ci.p_summary_long", `Keep the summary under ${MAX_TEXT} characters.`, { max: MAX_TEXT }));
  if ((issues ?? "").length > MAX_TEXT) problems.push(say("ci.p_issues_long", `Keep the issues under ${MAX_TEXT} characters.`, { max: MAX_TEXT }));
  if (needsPmAction && !(issues ?? "").trim()) problems.push(say("ci.p_needs_issue", "Describe the issue your Project Manager needs to act on."));
  if (taskIds.length > MAX_LINKED_TASKS) problems.push(say("ci.p_tasks_max", `Link at most ${MAX_LINKED_TASKS} tasks.`, { max: MAX_LINKED_TASKS }));
  if (photoCount > MAX_PHOTOS) problems.push(say("ci.p_photos_max", `Add at most ${MAX_PHOTOS} photos.`, { max: MAX_PHOTOS }));
  return problems;
}

// "Saved on this phone" slots win over the server's view, so a slot whose
// check-in is queued is not offered twice.
/**
 * @param {import("../api").CheckinSlot[]} serverSlots
 * @param {{ project_id: string, slot: string }[]} pendingSlots
 * @param {string} projectId
 * @returns {(Omit<import("../api").CheckinSlot, "state"> & { state: import("../api").CheckinSlot["state"] | "Queued" })[]}
 */
export function slotStates(serverSlots, pendingSlots, projectId) {
  const queued = new Set(pendingSlots.filter((p) => p.project_id === projectId).map((p) => p.slot));
  return serverSlots.map((s) => (s.state !== "Submitted" && queued.has(s.slot) ? { ...s, state: "Queued" } : s));
}
