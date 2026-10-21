import React from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { COLORS, FONT } from "@/constants/expense-flow-colors";
import { scanTimeLabel, type ReceiptScan } from "@/lib/receipt-scans";
import { useOpenScan } from "@/lib/use-open-scan";

const AMBER = COLORS.amberText;
const AMBER_BG = COLORS.amberBannerFill;
const RED = COLORS.errorText;

// A receipt saved on this phone while offline (lib/sync/db.js offline_scans).
export type QueuedScan = {
  scan_id: string;
  file_name: string;
  created_at: string;
  sync_status: "PENDING" | "REJECTED";
  error_message: string | null;
  context: { mode?: string; ticket?: { subject?: string } | null } | null;
};

// Receipts uploaded for background scanning that haven't been submitted yet,
// plus receipts saved on the phone offline that are waiting to be uploaded.
// Renders nothing when there are none.
export function ScannedReceipts({
  scans,
  onDismiss,
  queued = [],
  onRemoveQueued,
}: {
  scans: ReceiptScan[];
  onDismiss: (scan: ReceiptScan) => void;
  queued?: QueuedScan[];
  onRemoveQueued?: (row: QueuedScan) => void;
}) {
  const { openReady, openManual, openScanning } = useOpenScan();
  if (scans.length === 0 && queued.length === 0) return null;

  function confirmRemoveQueued(row: QueuedScan) {
    Alert.alert("Remove this receipt?", "It hasn't been uploaded yet, so it will be deleted from this phone.", [
      { text: "Keep", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => onRemoveQueued?.(row) },
    ]);
  }

  function open(scan: ReceiptScan) {
    if (scan.status === "Ready") openReady(scan);
    else if (scan.status === "Failed") openManual(scan);
    else openScanning(scan);
  }

  function confirmDismiss(scan: ReceiptScan) {
    Alert.alert("Remove this receipt?", "It won't be submitted. The photo stays on the server.", [
      { text: "Keep", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => onDismiss(scan) },
    ]);
  }

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Scanned receipts</Text>
      {queued.map((row) => {
        const title = row.context?.mode === "split" ? "Split receipt" : row.context?.ticket?.subject ?? "Receipt";
        const rejected = row.sync_status === "REJECTED";
        return (
          <Pressable
            key={row.scan_id}
            onLongPress={() => confirmRemoveQueued(row)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityHint="Long-press to remove"
          >
            <View style={styles.flex}>
              <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
              <Text style={[styles.rowMeta, rejected && { color: RED }]} numberOfLines={2}>
                {rejected
                  ? `Couldn't upload: ${row.error_message ?? "the server refused this file"}`
                  : `Saved on your phone · ${scanTimeLabel(row.created_at)} · uploads when you're back online`}
              </Text>
            </View>
            <View style={[styles.pill, { backgroundColor: rejected ? COLORS.errorFill : COLORS.bg }]}>
              <IconSymbol name={rejected ? "exclamationmark.triangle.fill" : "clock.fill"} size={14} color={rejected ? RED : COLORS.muted} />
              <Text style={[styles.pillText, { color: rejected ? RED : COLORS.muted }]}>{rejected ? "Not uploaded" : "Waiting"}</Text>
            </View>
            <Pressable onPress={() => confirmRemoveQueued(row)} hitSlop={10} accessibilityLabel="Remove this receipt">
              <Text style={styles.remove}>×</Text>
            </Pressable>
          </Pressable>
        );
      })}
      {scans.map((scan) => {
        const title = scan.context?.mode === "split" ? "Split receipt" : scan.context?.ticket?.subject ?? "Receipt";
        const vendor = scan.status === "Ready" ? scan.result?.vendorName : null;
        return (
          <Pressable
            key={scan.scanID}
            onPress={() => open(scan)}
            onLongPress={() => confirmDismiss(scan)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityHint="Long-press to remove"
          >
            <View style={styles.flex}>
              <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {[vendor, scanTimeLabel(scan.createdAt)].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <StatusPill status={scan.status} />
            <Pressable onPress={() => confirmDismiss(scan)} hitSlop={10} accessibilityLabel="Remove this receipt">
              <Text style={styles.remove}>×</Text>
            </Pressable>
          </Pressable>
        );
      })}
    </View>
  );
}

function StatusPill({ status }: { status: ReceiptScan["status"] }) {
  if (status === "Scanning") {
    return (
      <View style={[styles.pill, { backgroundColor: COLORS.bg }]}>
        <ActivityIndicator size="small" color={COLORS.primary} />
        <Text style={[styles.pillText, { color: COLORS.muted }]}>Reading…</Text>
      </View>
    );
  }
  if (status === "Ready") {
    return (
      <View style={[styles.pill, { backgroundColor: COLORS.successBg }]}>
        <IconSymbol name="checkmark.seal.fill" size={14} color={COLORS.success} />
        <Text style={[styles.pillText, { color: COLORS.success }]}>Review ›</Text>
      </View>
    );
  }
  return (
    <View style={[styles.pill, { backgroundColor: AMBER_BG }]}>
      <IconSymbol name="exclamationmark.triangle.fill" size={14} color={AMBER} />
      <Text style={[styles.pillText, { color: AMBER }]}>Type it in ›</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 12, marginBottom: 12, gap: 8 },
  title: { fontSize: 15, fontFamily: FONT.extrabold, color: COLORS.heading },
  row: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: COLORS.border },
  pressed: { opacity: 0.7 },
  flex: { flex: 1 },
  rowTitle: { fontSize: 14, fontFamily: FONT.bold, color: COLORS.heading },
  rowMeta: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 2 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  pillText: { fontSize: 12, fontFamily: FONT.bold },
  remove: { fontSize: 20, fontFamily: FONT.regular, color: RED, paddingHorizontal: 2 },
});
