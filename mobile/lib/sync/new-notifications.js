// Which notifications are new enough to pop up as a banner (components/
// notification-toast.tsx). Pure, so it is tested in Node.
//
// lastSeenAt is the newest createdat we have already shown (or skipped), kept
// on the phone per user. The first time ever (null) nothing pops: whatever is
// already unread stays on the bell, so the user isn't hit by a burst of old
// banners. Only notifications created after that moment pop up.

/**
 * @param {{ notificationid: string, createdat: string, isread: boolean }[]} rows
 * @param {string | null} lastSeenAt
 * @returns {{ fresh: typeof rows, newestAt: string | null }}
 */
export function pickNewNotifications(rows, lastSeenAt) {
  const list = Array.isArray(rows) ? rows : [];
  let newestAt = lastSeenAt;
  for (const row of list) {
    if (!newestAt || Date.parse(row.createdat) > Date.parse(newestAt)) newestAt = row.createdat;
  }
  if (!lastSeenAt) return { fresh: [], newestAt };
  const seen = Date.parse(lastSeenAt);
  const fresh = list
    .filter((row) => !row.isread && Date.parse(row.createdat) > seen)
    .sort((a, b) => Date.parse(b.createdat) - Date.parse(a.createdat));
  return { fresh, newestAt };
}
