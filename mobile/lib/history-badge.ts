import { createTabBadge } from "@/lib/tab-badge";

// How many of the Purchaser's receipts the PM rejected: the badge on the History tab.
const badge = createTabBadge();
export const setRejectedBadge = badge.set;
export const useRejectedBadge = badge.use;
