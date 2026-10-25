import React, { useEffect, useMemo } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { StateCard } from "@/components/state-card";
import { StatusChip, type ChipTone } from "@/components/status-chip";
import { useLocale } from "@/lib/i18n-context";
import { formatPeso } from "@/lib/money";
import { scanTimeLabel } from "@/lib/receipt-scans";
import { trayRows, traySummary } from "@/lib/turn-in";
import { setTurnInBadge } from "@/lib/turnin-badge";
import { useOpenScan } from "@/lib/use-open-scan";
import { useScanTray } from "@/lib/use-scan-tray";
import type { QueuedScan } from "@/components/scanned-receipts";
import type { ReceiptScan } from "@/lib/receipt-scans";

type TrayState = "waiting" | "upload_failed" | "reading" | "failed" | "review";
type TrayRow = {
  key: string;
  kind: "scan" | "queued";
  state: TrayState;
  vendor: string | null;
  amount: number | null;
  trip: boolean;
  createdAt: string;
  scan?: ReceiptScan;
  queued?: QueuedScan;
};

const CHIP: Record<TrayState, { labelKey: string; tone: ChipTone }> = {
  waiting: { labelKey: "ti.waiting_signal", tone: "neutral" },
  upload_failed: { labelKey: "sr.not_uploaded", tone: "error" },
  reading: { labelKey: "sr.reading", tone: "info" },
  failed: { labelKey: "ti.type_in", tone: "amber" },
  review: { labelKey: "ti.needs_review", tone: "primary" },
};

// The end-of-day tray: every receipt snapped today that has not been handed over yet.
export default function TurnInScreen() {
  const { t, intlLocale } = useLocale();
  const tray = useScanTray();
  const { openReady, openManual, openScanning } = useOpenScan();

  const rows = useMemo(() => trayRows(tray.scans, tray.queuedScans) as TrayRow[], [tray.scans, tray.queuedScans]);
  const summary = traySummary(rows);

  // Show how many are waiting on the tab itself.
  useEffect(() => {
    setTurnInBadge(rows.length);
  }, [rows.length]);

  function open(row: TrayRow) {
    if (row.scan) {
      if (row.state === "review") openReady(row.scan);
      else if (row.state === "failed") openManual(row.scan);
      else openScanning(row.scan);
    } else if (row.state === "upload_failed") {
      confirmRemove(row);
    }
  }

  function confirmRemove(row: TrayRow) {
    Alert.alert(t("sr.remove_title"), t(row.queued ? "sr.remove_queued_body" : "sr.remove_scan_body"), [
      { text: t("sr.keep"), style: "cancel" },
      {
        text: t("common.remove"),
        style: "destructive",
        onPress: () => (row.queued ? tray.removeQueued(row.queued) : row.scan && tray.removeScan(row.scan)),
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("ti.title")}</Text>
        <Text style={styles.subtitle}>
          {summary.count > 0
            ? t(summary.count === 1 ? "ti.summary_one" : "ti.summary_other", { count: summary.count, total: formatPeso(summary.total) })
            : t("ti.subtitle")}
        </Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        contentContainerStyle={styles.list}
        refreshing={false}
        onRefresh={tray.reload}
        ListEmptyComponent={<StateCard kind="empty" title={t("ti.empty_title")} body={t("ti.empty_body")} />}
        renderItem={({ item: row }) => {
          const chip = CHIP[row.state];
          const rejected = row.state === "upload_failed";
          return (
          <View style={styles.card}>
            <Pressable
              onPress={() => open(row)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
              accessibilityRole="button"
            >
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle} numberOfLines={1}>{row.trip ? `${t("ti.kind_trip")} · ` : ""}{row.vendor ?? t("mobile.receipt")}</Text>
                <Text style={[styles.rowMeta, rejected && { color: COLORS.errorText }]} numberOfLines={2}>
                  {rejected
                    ? t("sr.upload_failed", { reason: row.queued?.error_message ?? t("sr.server_refused") })
                    : scanTimeLabel(row.createdAt, t, intlLocale)}
                </Text>
                <View style={styles.chipRow}>
                  {row.state === "reading" ? <ActivityIndicator size="small" color={COLORS.primary} /> : null}
                  <StatusChip label={t(chip.labelKey)} tone={chip.tone} />
                </View>
              </View>
              {row.amount != null ? <Text style={styles.amount}>{formatPeso(row.amount)}</Text> : null}
            </Pressable>
            <Pressable onPress={() => confirmRemove(row)} style={styles.removeBtn} accessibilityRole="button" accessibilityLabel={`${t("common.remove")}: ${row.vendor ?? t("mobile.receipt")}`}>
              <Text style={styles.removeText}>{t("common.remove")}</Text>
            </Pressable>
          </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },

  header: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  title: { fontSize: 26, fontFamily: FONT.extrabold, color: COLORS.heading },
  subtitle: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 2 },

  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  card: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10, minHeight: MIN_TAP, padding: 14 },
  removeBtn: { minHeight: MIN_TAP, justifyContent: "center", alignItems: "flex-end", paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: COLORS.border },
  removeText: { fontSize: 13, fontFamily: FONT.bold, color: COLORS.errorText },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontFamily: FONT.bold, color: COLORS.heading },
  rowMeta: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted },
  chipRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  amount: { fontSize: 16, fontFamily: FONT.extrabold, color: COLORS.heading },
});
