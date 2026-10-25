import { useSyncExternalStore } from "react";

// A count shown on a tab. The screen sets it each time it loads, and the tab bar reads it.
export function createTabBadge() {
  let count = 0;
  const listeners = new Set<() => void>();

  return {
    set(next: number) {
      if (next === count) return;
      count = next;
      listeners.forEach((listener) => listener());
    },
    use() {
      return useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        () => count,
        () => 0
      );
    },
  };
}
