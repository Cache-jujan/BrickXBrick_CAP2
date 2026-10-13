import React from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { COLORS } from "@/constants/expense-flow-colors";
import { scanTimeLabel, type ReceiptScan } from "@/lib/receipt-scans";
import { useOpenScan } from "@/lib/use-open-scan";

const AMBER = "#B45309";
const AMBER_BG = "#FEF3C7";
const RED = "#C1121F";

// Receipts uploaded for background scanning that haven't been submitted yet.
// Renders nothing when there are none.
export function ScannedReceipts({ scans, onDismiss }: { scans: ReceiptScan[]; onDismiss: (scan: ReceiptScan) => void }) {
  const { openReady, openManual, openScanning } = useOpenScan();
  if (scans.length === 0) return null;

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
  title: { fontSize: 15, fontWeight: "800", color: COLORS.heading },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: COLORS.border },
  pressed: { opacity: 0.7 },
  flex: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: "700", color: COLORS.heading },
  rowMeta: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  pillText: { fontSize: 12, fontWeight: "700" },
  remove: { fontSize: 20, color: RED, paddingHorizontal: 2 },
});
