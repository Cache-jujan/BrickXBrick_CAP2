import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";

import { getSession } from "@/lib/auth";
import { getRecentSynced } from "@/lib/sync/db";
import { describeSyncedItem, pesoText } from "@/lib/sync/messages";
import { useNetwork } from "@/lib/sync/network-context";
import { relativeTime } from "@/lib/notificationMeta";
import { useLocale } from "@/lib/i18n-context";
import { COLORS, FONT } from "@/constants/expense-flow-colors";

const SHOWN = 5;

type Row = { id: string; kind: string; title: string; project: string | null; amount: number | null; savedAt: string | null; syncedAt: string };

/**
 * F10: "Recently synced". What this phone sent to the server in the last 72
 * hours (expenses, task updates, check-ins, receipt photos), newest first, so
 * the Purchaser or Site Manager can see exactly which items went after
 * reconnecting. Reads the sync_labels table (lib/sync/db.js); refreshes when a
 * sync finishes and when the screen comes back into view. Hidden when empty.
 * Same box and row styles as components/scanned-receipts.tsx.
 */
export function RecentSyncs() {
  const { t, intlLocale } = useLocale();
  const { lastSync } = useNetwork();
  const [rows, setRows] = useState<Row[]>([]);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(() => {
    const userId = getSession()?.user.id;
    setRows(userId ? (getRecentSynced(userId) as Row[]) : []);
  }, []);

  useEffect(load, [load, lastSync]);
  useFocusEffect(load);

  // Tap a row: everything the phone kept about it, including when it was saved offline.
  function showDetails(row: Row) {
    const when = (iso: string | null) =>
      iso ? new Date(iso).toLocaleString(intlLocale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
    const lines: [string, string | null][] = [
      [t("sync.detail_name"), row.title],
      [t("sync.detail_project"), row.project],
      [t("sync.detail_amount"), row.amount != null ? pesoText(row.amount) : null],
      [t("sync.detail_saved"), when(row.savedAt)],
      [t("sync.detail_synced"), when(row.syncedAt)],
    ];
    Alert.alert(
      t(`sync.recent_${row.kind}`),
      lines.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join("\n")
    );
  }

  if (rows.length === 0) return null;
  const shown = expanded ? rows : rows.slice(0, SHOWN);

  return (
    <View style={styles.box} accessibilityLabel={t("sync.recent_title")}>
      <Text style={styles.title}>{t("sync.recent_title")}</Text>
      <Text style={styles.rowMeta}>{t("sync.recent_note")}</Text>
      {shown.map((row) => (
        <Pressable
          key={row.id}
          onPress={() => showDetails(row)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <View style={styles.flex}>
            <Text style={styles.rowTitle}>{describeSyncedItem(row, t)}</Text>
            <Text style={styles.rowMeta}>
              {t(`sync.recent_${row.kind}`)} · {relativeTime(row.syncedAt, t, intlLocale)}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ))}
      {rows.length > SHOWN && (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.rowTitle}>{expanded ? t("sync.show_less") : t("sync.show_all", { count: rows.length })}</Text>
        </Pressable>
      )}
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
  chevron: { fontSize: 20, fontFamily: FONT.regular, color: COLORS.muted },
});
