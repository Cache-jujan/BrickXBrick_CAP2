import { createTabBadge } from "@/lib/tab-badge";

// How many receipts are waiting in the tray: the badge on the Turn In tab.
const badge = createTabBadge();
export const setTurnInBadge = badge.set;
export const useTurnInBadge = badge.use;
