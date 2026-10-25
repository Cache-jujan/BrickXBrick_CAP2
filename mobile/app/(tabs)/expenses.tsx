import React, { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";

import type { MyExpense, Project } from "@/lib/api";
import { loadActiveProjects, loadMyExpenses } from "@/lib/cached-api";
import { describeLoadError } from "@/lib/sync/messages";
import { savedAtLabel } from "@/lib/sync/offline-cache";
import { useNetwork } from "@/lib/sync/network-context";
import { formatPeso } from "@/lib/money";
import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { ExpenseActions } from "@/components/expense-actions";
import { StateCard } from "@/components/state-card";
import { StatusChip, type ChipTone } from "@/components/status-chip";
import { useLocale } from "@/lib/i18n-context";

type FilterKey = "All" | "Under review" | "Approved";
const FILTER_KEYS: FilterKey[] = ["All", "Under review", "Approved"];

// The API's "Pending" is shown to the Purchaser as "Under review".
const STATUS: Record<MyExpense["status"], { label: string; tone: ChipTone }> = {
  Pending: { label: "mobile.under_review", tone: "amber" },
  Approved: { label: "mobile.approved", tone: "success" },
  Rejected: { label: "mobile.rejected", tone: "error" },
};

function matchesFilter(expense: MyExpense, filter: FilterKey) {
  if (filter === "All") return true;
  return filter === "Approved" ? expense.status === "Approved" : expense.status === "Pending";
}

function shortDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-PH", { day: "numeric", month: "short" });
}

export default function ExpensesScreen() {
  const { t, intlLocale } = useLocale();
  const { isOnline } = useNetwork();
  const [expenses, setExpenses] = useState<MyExpense[]>([]);
  const [projectsById, setProjectsById] = useState<Record<string, Project>>({});
  const [filter, setFilter] = useState<FilterKey>("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Offline-first: when the list on screen is the copy saved on this phone.
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [expenseResult, projectResult] = await Promise.all([loadMyExpenses(), loadActiveProjects()]);
      setExpenses(expenseResult.data);
      setSavedAt(expenseResult.fromCache ? expenseResult.savedAt : null);
      setProjectsById(Object.fromEntries(projectResult.data.map((p) => [p.projectid, p])));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.something"));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const shownError = describeLoadError(error, isOnline);
  const visible = expenses.filter((e) => matchesFilter(e, filter));

  // "Submitted this month": everything the Purchaser sent in this calendar month.
  const now = new Date();
  const thisMonth = expenses.filter((e) => {
    const submitted = new Date(e.submittedAt);
    return submitted.getFullYear() === now.getFullYear() && submitted.getMonth() === now.getMonth();
  });
  const monthTotal = thisMonth.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const underReview = expenses.filter((e) => e.status === "Pending").length;
  const approved = expenses.filter((e) => e.status === "Approved").length;

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("mobile.expenses")}</Text>
        <Text style={styles.subtitle}>{t("mobile.receipts_submitted")}</Text>
      </View>

      <View style={styles.filterRow}>
        {FILTER_KEYS.map((key) => (
          <Pressable
            key={key}
            onPress={() => setFilter(key)}
            style={[styles.pill, filter === key && styles.pillActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === key }}
          >
            <Text style={[styles.pillText, filter === key && styles.pillTextActive]}>{t(key === "All" ? "common.all" : `mobile.${key === "Under review" ? "under_review" : key.toLowerCase()}`)}</Text>
          </Pressable>
        ))}
      </View>

      {savedAt && (
        <Text style={styles.offlineNote}>
          {t("ex.offline_showing", { reason: isOnline ? t("sm.cant_reach") : t("mx.offline_title"), when: savedAtLabel(savedAt, new Date(), t, intlLocale) })}
        </Text>
      )}
      {shownError && (
        <View style={styles.stateWrap}>
            <StateCard kind="error" title={t("mobile.expenses_load_error")} body={shownError} onRetry={load} />
        </View>
      )}

      <FlatList
        data={visible}
        keyExtractor={(e) => e.expenseID}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={
          <View style={styles.summary}>
            <View style={styles.flex}>
              <Text style={styles.summaryLabel}>{t("mobile.submitted_this_month")}</Text>
              <Text style={styles.summaryTotal}>{formatPeso(monthTotal)}</Text>
            </View>
            <View style={styles.summaryCounts}>
              <Text style={styles.summaryCount}>{t("mobile.under_review_count", { count: underReview })}</Text>
              <Text style={styles.summaryCount}>{t("mobile.approved_count", { count: approved })}</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <StateCard kind="empty" title={t("mobile.no_expenses_view")} body={t("mobile.expenses_empty_help")} />
          ) : null
        }
        renderItem={({ item }) => {
          const status = STATUS[item.status];
          const split = (item.splitProjectCount ?? 0) > 1;
          const projectName = projectsById[item.projectID]?.name ?? t("mr.unknown_project");
          const metaLabel = split ? t("mobile.split_across_projects", { count: item.splitProjectCount ?? 0 }) : projectName;

          return (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle} numberOfLines={2}>{item.vendorName?.trim() || t("mobile.receipt")}</Text>
                <Text style={styles.cardAmount}>{formatPeso(item.amount)}</Text>
              </View>
              <Text style={styles.cardMeta} numberOfLines={1}>
                {[metaLabel, shortDate(item.receiptDate ?? item.submittedAt)].filter(Boolean).join(" · ")}
              </Text>
              <View style={styles.chipRow}>
                <StatusChip label={t(status.label)} tone={status.tone} />
                {split ? <StatusChip label={t("mobile.split")} tone="primary" /> : null}
              </View>
              {item.status === "Rejected" && item.rejectionReason ? (
                <Text style={styles.reason}>{item.rejectionReason}</Text>
              ) : null}
            </View>
          );
        }}
      />

      <ExpenseActions />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },

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

  list: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },

  summary: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginBottom: 4 },
  summaryLabel: { fontSize: 12, fontFamily: FONT.medium, color: COLORS.muted },
  summaryTotal: { fontSize: 24, fontFamily: FONT.extrabold, color: COLORS.heading, marginTop: 2 },
  summaryCounts: { alignItems: "flex-end", gap: 2 },
  summaryCount: { fontSize: 12, fontFamily: FONT.semibold, color: COLORS.muted },

  card: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 14 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  cardTitle: { flex: 1, fontSize: 16, fontFamily: FONT.bold, color: COLORS.heading },
  cardAmount: { fontSize: 16, fontFamily: FONT.extrabold, color: COLORS.heading },
  cardMeta: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  reason: { fontSize: 12, fontFamily: FONT.medium, color: COLORS.errorText, marginTop: 8 },
});
