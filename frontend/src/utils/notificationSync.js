// Keeps notifications in step across browser tabs.
//
// Every tab has its own copy of the notification state, so marking something
// read in one tab used to leave the other tabs showing it as unread. Two things
// fix that:
//   1. when a tab marks notifications read it broadcasts "changed", and every
//      other tab refetches straight away;
//   2. a tab also refetches when you come back to it (tab switch or window
//      focus), because background tabs throttle timers and can miss a message.

const CHANNEL_NAME = "brickxbrick-notifications";
const FOCUS_THROTTLE_MS = 1000;

let channel = null;

function getChannel() {
  if (channel) return channel;
  try {
    if (typeof BroadcastChannel !== "undefined") channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
  return channel;
}

// Call after a mark-read / mark-all-read succeeds. Other tabs get the message;
// the tab that sent it does not, and it has already updated its own state.
export function notifyNotificationsChanged() {
  try {
    getChannel()?.postMessage({ type: "changed" });
  } catch {
    // Broadcasting is best effort. The focus refresh below still catches up.
  }
}

// Calls refresh() when another tab changed notifications, and when this tab
// becomes visible or focused again. Returns an unsubscribe function.
export function subscribeNotificationsRefresh(refresh) {
  const ch = getChannel();
  let last = 0;

  function onMessage() {
    refresh();
  }

  function onReturn() {
    if (document.visibilityState === "hidden") return;
    const now = Date.now();
    if (now - last < FOCUS_THROTTLE_MS) return; // visibilitychange + focus often fire together
    last = now;
    refresh();
  }

  ch?.addEventListener("message", onMessage);
  document.addEventListener("visibilitychange", onReturn);
  window.addEventListener("focus", onReturn);

  return () => {
    ch?.removeEventListener("message", onMessage);
    document.removeEventListener("visibilitychange", onReturn);
    window.removeEventListener("focus", onReturn);
  };
}