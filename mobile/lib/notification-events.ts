// "Something new arrived" signal from the notification pop-up
// (components/notification-toast.tsx) to the screens on show, so a task the
// PM just accepted or flagged updates without a manual pull-to-refresh.
import { useEffect, useRef } from "react";

const listeners = new Set<() => void>();

export function emitNewNotifications() {
  listeners.forEach((listener) => listener());
}

// Calls onNew each time new notifications arrive while this screen is mounted.
export function useOnNewNotifications(onNew: () => void) {
  const latest = useRef(onNew);
  latest.current = onNew;
  useEffect(() => {
    const listener = () => latest.current();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}

// A receipt scan was just started: ask the notification pop-up to check often for a while,
// so "your receipt is ready" shows up soon after the server finishes reading it.
const expediters = new Set<() => void>();

export function expediteNotificationChecks() {
  expediters.forEach((run) => run());
}

const EXPEDITE_EVERY_MS = 4_000;
const EXPEDITE_FOR_MS = 60_000;

export function useOnExpediteChecks(check: () => void) {
  const latest = useRef(check);
  latest.current = check;
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopAt = 0;
    const run = () => {
      stopAt = Date.now() + EXPEDITE_FOR_MS;
      if (timer) return; // already checking often; just extended the time
      timer = setInterval(() => {
        latest.current();
        if (Date.now() > stopAt && timer) {
          clearInterval(timer);
          timer = null;
        }
      }, EXPEDITE_EVERY_MS);
    };
    expediters.add(run);
    return () => {
      expediters.delete(run);
      if (timer) clearInterval(timer);
    };
  }, []);
}
