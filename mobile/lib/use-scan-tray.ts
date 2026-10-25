import React, { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "expo-router";

import { loadScans as loadScansCached } from "@/lib/cached-api";
import { getSession } from "@/lib/auth";
import { dismissScan, type ReceiptScan } from "@/lib/receipt-scans";
import { getPendingScans, getRejectedScans, removeQueuedScan } from "@/lib/sync/db";
import { useNetwork } from "@/lib/sync/network-context";
import { deleteQueuedPhoto } from "@/lib/sync/task-photo";
import type { QueuedScan } from "@/components/scanned-receipts";

// While a receipt is still being read, refresh the list this often.
const SCAN_REFRESH_MS = 4000;

// The Purchaser's receipt tray: scans the server is reading or has read, plus photos
// still on this phone waiting for a signal. Keeps itself fresh while a screen using it
// is on show, after a sync, and when the phone comes back online.
export function useScanTray() {
  const [scans, setScans] = useState<ReceiptScan[]>([]);
  const [queuedScans, setQueuedScans] = useState<QueuedScan[]>([]);
  const [focused, setFocused] = useState(false);
  const { isOnline, pendingCount, lastSync } = useNetwork();

  const refreshQueued = useCallback(() => {
    const userId = getSession()?.user.id ?? null;
    setQueuedScans([...getPendingScans(userId), ...getRejectedScans(userId)] as QueuedScan[]);
  }, []);

  // A failure here must not hide the rest of the screen: keep what was shown.
  const reloadScans = useCallback(async () => {
    try {
      setScans((await loadScansCached()).data);
    } catch {
      // The next refresh tries again.
    }
  }, []);

  const reload = useCallback(() => {
    reloadScans();
    refreshQueued();
  }, [reloadScans, refreshQueued]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      reload();
      return () => setFocused(false);
    }, [reload])
  );

  // A sync just ran: receipts may have been uploaded.
  useEffect(() => {
    refreshQueued();
    if (lastSync?.result?.scans?.uploaded) reloadScans();
  }, [pendingCount, lastSync, refreshQueued, reloadScans]);

  const wasOnline = React.useRef(isOnline);
  useEffect(() => {
    if (isOnline && !wasOnline.current) reload();
    wasOnline.current = isOnline;
  }, [isOnline, reload]);

  // Keep "Reading..." rows moving to "Review" without a manual pull-to-refresh.
  const anyScanning = scans.some((scan) => scan.status === "Scanning");
  useEffect(() => {
    if (!focused || !anyScanning) return;
    const timer = setInterval(reloadScans, SCAN_REFRESH_MS);
    return () => clearInterval(timer);
  }, [focused, anyScanning, reloadScans]);

  const removeScan = useCallback(
    (scan: ReceiptScan) => {
      setScans((prev) => prev.filter((s) => s.scanID !== scan.scanID));
      dismissScan(scan.scanID).catch(() => reloadScans());
    },
    [reloadScans]
  );

  const removeQueued = useCallback(
    (row: QueuedScan) => {
      deleteQueuedPhoto(removeQueuedScan(row.scan_id));
      refreshQueued();
    },
    [refreshQueued]
  );

  return { scans, queuedScans, reload, removeScan, removeQueued };
}
