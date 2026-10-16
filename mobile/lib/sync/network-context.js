// F10 — Network + offline-queue state for the whole app.
//
// Provides { isOnline, pendingCount, refreshPendingCount }.
// - 10.1: NetInfo listener flips isOnline automatically.
// - 10.6: on reconnect (and on app start if already online), sync everything queued
//         (expenses and task submissions).
//         Also re-checks every 15s while online with items queued, so a sync that failed
//         (server not reachable yet, or user not signed in yet) is picked up later.
// - 10.7: rejected items are not retried; the alert shows the server's reason.
// - 10.8: exactly ONE alert per sync run, summarising synced + rejected.

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import NetInfo from "@react-native-community/netinfo";

import { initDb, getPendingCount } from "@/lib/sync/db";
import { buildSyncSummary } from "@/lib/sync/messages";
import { syncAllPending } from "@/lib/sync/sync";

const RECHECK_INTERVAL_MS = 15000;

const NetworkContext = createContext({
  isOnline: true,
  pendingCount: 0,
  refreshPendingCount: () => {},
});

export function NetworkProvider({ children }) {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const syncingRef = useRef(false);
  const onlineRef = useRef(true);

  const refreshPendingCount = useCallback(() => {
    setPendingCount(getPendingCount());
  }, []);

  const runSync = useCallback(async () => {
    if (syncingRef.current) return; // never run two syncs at once
    if (getPendingCount() === 0) return;
    syncingRef.current = true;
    try {
      const result = await syncAllPending();
      refreshPendingCount();
      const summary = buildSyncSummary(result); // null when nothing happened
      if (!summary) return;
      if (result.rejected > 0) {
        console.warn("[F10 sync] rejected:", result.rejectedItems.map((i) => `${i.code}: ${i.message}`).join(" | "));
      }
      Alert.alert(summary.title, summary.message);
    } catch (err) {
      // Request failed (server unreachable, 401 not signed in, 5xx).
      // Rows stay 'pending'; the 15s re-check below will try again.
      console.warn("[F10 sync] failed:", err?.message ?? err);
    } finally {
      syncingRef.current = false;
    }
  }, [refreshPendingCount]);

  useEffect(() => {
    initDb();
    refreshPendingCount();

    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = !!state.isConnected && state.isInternetReachable !== false;
      onlineRef.current = online;
      setIsOnline(online);
      if (online) runSync();
    });

    const timer = setInterval(() => {
      if (onlineRef.current) runSync();
    }, RECHECK_INTERVAL_MS);

    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [refreshPendingCount, runSync]);

  return (
    <NetworkContext.Provider value={{ isOnline, pendingCount, refreshPendingCount }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  return useContext(NetworkContext);
}