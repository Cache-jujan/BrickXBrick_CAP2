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
