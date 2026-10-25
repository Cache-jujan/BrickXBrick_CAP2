import React, { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";

import type { MyExpense } from "@/lib/api";
import { loadMyExpenses } from "@/lib/cached-api";
import { describeLoadError } from "@/lib/sync/messages";
import { savedAtLabel } from "@/lib/sync/offline-cache";
import { useNetwork } from "@/lib/sync/network-context";
import { useOnNewNotifications } from "@/lib/notification-events";
import { groupReceipts, dayKey, rejectedCount } from "@/lib/history-groups";
import { setRejectedBadge } from "@/lib/history-badge";
import { fileFromExpense, ocrResultFromExpense } from "@/lib/resubmit";
import { useExpenseDraft } from "@/lib/expense-draft-context";
import { formatPeso } from "@/lib/money";
import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { StateCard } from "@/components/state-card";
import { StatusChip, type ChipTone } from "@/components/status-chip";
import { useLocale } from "@/lib/i18n-context";

type FilterKey = "all" | "waiting" | "approved" | "rejected";
const FILTERS: { key: FilterKey; labelKey: string; status?: MyExpense["status"] }[] = [
  { key: "all", labelKey: "common.all" },
  { key: "waiting", labelKey: "hist.f_waiting", status: "Pending" },
  { key: "approved", labelKey: "hist.f_approved", status: "Approved" },
  { key: "rejected", labelKey: "hist.f_rejected", status: "Rejected" },
];

const STATUS: Record<MyExpense["status"], { labelKey: string; tone: ChipTone }> = {
  Pending: { labelKey: "hist.waiting", tone: "amber" },
  Approved: { labelKey: "mobile.approved", tone: "success" },
  Rejected: { labelKey: "mobile.rejected", tone: "error" },
};

// Receipts you have handed in, newest day first, with what the Project Manager decided.
export default function HistoryScreen() {
  const { t, formatDate } = useLocale();
  const { isOnline } = useNetwork();
  const { startResubmit } = useExpenseDraft();
  const [expenses, setExpenses] = useState<MyExpense[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Offline-first: when the list on screen is the copy saved on this phone.
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await loadMyExpenses();
      setExpenses(result.data);
      setSavedAt(result.fromCache ? result.savedAt : null);
      setRejectedBadge(rejectedCount(result.data));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.something"));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  // The PM just approved or rejected something: show it without a manual pull.
  useOnNewNotifications(() => { load(); });

  const shownError = describeLoadError(error, isOnline);

  const sections = useMemo(() => {
    const wanted = FILTERS.find((f) => f.key === filter)?.status;
    const shown = wanted ? expenses.filter((e) => e.status === wanted) : expenses;
    const today = dayKey(new Date().toISOString());
    const yesterday = dayKey(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    return groupReceipts(shown).map((group) => ({
      title:
        group.day === today
          ? t("hist.today")
          : group.day === yesterday
            ? t("hist.yesterday")
            : formatDate(group.receipts[0].submittedAt, { day: "numeric", month: "short", year: "numeric" }),
      data: group.receipts,
    }));
  }, [expenses, filter, t, formatDate]);

  // A Rejected receipt goes back through the review screen, then updates the same
  // expense (PATCH .../resubmit) instead of creating a new one.
  function fixRejected(expense: MyExpense) {
    startResubmit({
      expenseID: expense.expenseID,
      reason: expense.rejectionReason,
      ticket: expense.ticketID
        ? {
            ticketId: expense.ticketID,
            projectId: expense.projectID,
            projectName: expense.projectName ?? t("mr.unknown_project"),
            subject: expense.ticketSubject ?? "",
          }
        : null,
      file: fileFromExpense(expense),
      ocrResult: ocrResultFromExpense(expense),
      category: expense.category,
    });
    router.push("/expense/review");
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("hist.title")}</Text>
        <Text style={styles.subtitle}>{t("hist.subtitle")}</Text>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map(({ key, labelKey }) => (
          <Pressable
            key={key}
            onPress={() => setFilter(key)}
            style={[styles.pill, filter === key && styles.pillActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === key }}
          >
            <Text style={[styles.pillText, filter === key && styles.pillTextActive]}>{t(labelKey)}</Text>
          </Pressable>
        ))}
      </View>

      {savedAt && (
        <Text style={styles.offlineNote}>
          {t("ex.offline_showing", { reason: isOnline ? t("sm.cant_reach") : t("mx.offline_title"), when: savedAtLabel(savedAt, new Date(), t) })}
        </Text>
      )}
      {shownError && (
        <View style={styles.stateWrap}>
          <StateCard kind="error" title={t("mobile.expenses_load_error")} body={shownError} onRetry={load} />
        </View>
      )}

      <SectionList
        sections={sections}
        keyExtractor={(receipt) => receipt.key}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={
          !loading ? (
            <StateCard
              kind="empty"
              title={filter === "all" ? t("hist.empty_title") : t("hist.empty_filter")}
              body={t("hist.empty_body")}
            />
          ) : null
        }
        renderSectionHeader={({ section }) => <Text style={styles.dayHeading}>{section.title}</Text>}
        renderItem={({ item: receipt }) => {
          const status = STATUS[receipt.status as MyExpense["status"]];
          const split = receipt.items.length > 1;
          const first = receipt.items[0] as MyExpense;
          const vendor = first.vendorName?.trim() || t("mobile.receipt");
          // Portions are one expense per request, so count projects, not portions.
          const projectNames = [...new Set((receipt.items as MyExpense[]).map((i) => i.projectName ?? ""))];
          const acrossProjects = projectNames.length > 1;
          const subtitle = acrossProjects
            ? t("mobile.split_across_projects", { count: projectNames.length })
            : split
              ? [first.projectName, t("tb.items_other", { count: receipt.items.length })].filter(Boolean).join(" · ")
              : [first.projectName, first.ticketSubject].filter(Boolean).join(" · ") || t("mr.unknown_project");

          return (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle} numberOfLines={2}>{vendor}</Text>
                <Text style={styles.cardAmount}>{formatPeso(receipt.total)}</Text>
              </View>
              <Text style={styles.cardMeta} numberOfLines={2}>{subtitle}</Text>
              <View style={styles.chipRow}>
                <StatusChip label={t(status.labelKey)} tone={status.tone} />
                {acrossProjects ? <StatusChip label={t("mobile.split")} tone="primary" /> : null}
              </View>

              {split
                ? (receipt.items as MyExpense[]).map((portion) => (
                    <View key={portion.expenseID} style={styles.portion}>
                      <View style={styles.cardTop}>
                        <Text style={styles.portionName} numberOfLines={2}>{(acrossProjects ? portion.projectName : portion.ticketSubject || portion.projectName) ?? t("mr.unknown_project")}</Text>
                        <Text style={styles.portionAmount}>{formatPeso(portion.amount)}</Text>
                      </View>
                      {portion.status !== "Pending" ? (
                        <StatusChip label={t(STATUS[portion.status].labelKey)} tone={STATUS[portion.status].tone} />
                      ) : null}
                      {portion.status === "Rejected" ? <Rejected expense={portion} onFix={fixRejected} t={t} /> : null}
                    </View>
                  ))
                : first.status === "Rejected"
                  ? <Rejected expense={first} onFix={fixRejected} t={t} />
                  : null}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

function Rejected({ expense, onFix, t }: { expense: MyExpense; onFix: (e: MyExpense) => void; t: (key: string) => string }) {
  return (
    <View style={styles.rejected}>
      {expense.rejectionReason ? <Text style={styles.reason}>{t("hist.pm_note")}: {expense.rejectionReason}</Text> : null}
      <Pressable
        onPress={() => onFix(expense)}
        style={({ pressed }) => [styles.fixButton, pressed && { opacity: 0.8 }]}
        accessibilityRole="button"
      >
        <Text style={styles.fixText}>{t("hist.fix")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },

  header: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  title: { fontSize: 26, fontFamily: FONT.extrabold, color: COLORS.heading },
  subtitle: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 2 },

  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  pill: { minHeight: MIN_TAP, justifyContent: "center", paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: COLORS.inputBorder, backgroundColor: COLORS.card },
  pillActive: { backgroundColor: COLORS.primaryTint, borderColor: COLORS.primary },
  pillText: { fontSize: 13, fontFamily: FONT.semibold, color: COLORS.muted },
  pillTextActive: { color: COLORS.primaryTintText, fontFamily: FONT.bold },

  offlineNote: { color: COLORS.amberBannerText, backgroundColor: COLORS.amberBannerFill, marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 10, fontSize: 12, fontFamily: FONT.medium },
  stateWrap: { paddingHorizontal: 16, paddingBottom: 8 },

  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  dayHeading: { fontSize: 13, fontFamily: FONT.bold, color: COLORS.muted, marginTop: 10, marginBottom: 2 },

  card: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 14 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  cardTitle: { flex: 1, fontSize: 16, fontFamily: FONT.bold, color: COLORS.heading },
  cardAmount: { fontSize: 16, fontFamily: FONT.extrabold, color: COLORS.heading },
  cardMeta: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },

  portion: { borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 10, paddingTop: 10, gap: 6 },
  portionName: { flex: 1, fontSize: 14, fontFamily: FONT.semibold, color: COLORS.heading },
  portionAmount: { fontSize: 14, fontFamily: FONT.bold, color: COLORS.heading },

  rejected: { marginTop: 8, gap: 8 },
  reason: { fontSize: 12, fontFamily: FONT.medium, color: COLORS.errorText },
  fixButton: { alignSelf: "flex-start", minHeight: MIN_TAP, justifyContent: "center", paddingHorizontal: 16, borderRadius: 22, backgroundColor: COLORS.primary },
  fixText: { color: "#FFFFFF", fontSize: 13, fontFamily: FONT.bold },
});
