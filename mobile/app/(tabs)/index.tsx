import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useOnNewNotifications } from "@/lib/notification-events";
import { useFocusEffect } from "expo-router";

import {
  type Ticket,
  type Project,
} from "@/lib/api";
import { formatPeso, formatQty } from "@/lib/money";
import { dueSortKey, urgencyFor } from "@/lib/needed-by";
import {
  loadActiveProjects,
  loadAssignedTickets,
  loadScans as loadScansCached,
} from "@/lib/cached-api";
import { getPendingScans, getRejectedScans, removeQueuedScan } from "@/lib/sync/db";
import { savedAtLabel } from "@/lib/sync/offline-cache";
import { deleteQueuedPhoto } from "@/lib/sync/task-photo";
import { useExpenseDraft } from "@/lib/expense-draft-context";
import { getSession } from "@/lib/auth";
import { describeLoadError } from "@/lib/sync/messages";
import { useNetwork } from "@/lib/sync/network-context";
import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { ExpenseActions } from "@/components/expense-actions";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { AppButton } from "@/components/app-button";
import { StateCard } from "@/components/state-card";
import { StatusChip, type ChipTone } from "@/components/status-chip";
import { ScannedReceipts } from "@/components/scanned-receipts";
import { dismissScan, type ReceiptScan } from "@/lib/receipt-scans";
import type { QueuedScan } from "@/components/scanned-receipts";
import { useLocale } from "@/lib/i18n-context";
import { ToBuy } from "@/components/to-buy";

// While a receipt is still being read, refresh the list this often.
const SCAN_REFRESH_MS = 4000;

type FilterKey = "All" | "Pending" | "Completed";
const FILTER_KEYS: FilterKey[] = ["Pending", "Completed", "All"];
type SortKey = "due" | "newest";

// Purchasers can act on Acknowledged tickets and see Resolved tickets as
// completed. Site Managers see only their own Resolved Material Requests,
// which are ready for expense capture. The optional neededby date drives the Purchaser's urgency and sort.
function toBucket(
  status: string
): "Pending" | "Completed" | null {
  if (status === "Acknowledged") return "Pending";
  if (status === "Resolved") return "Completed";
  return null;
}

// The Purchaser opens on To Buy. The Site Manager keeps the list of requests ready for an expense.
export default function HomeScreen() {
  return getSession()?.user.role === "Site Manager" ? <SiteManagerHome /> : <ToBuy />;
}

function SiteManagerHome() {
  const { t, intlLocale } = useLocale();
  const { setTicket, reset, startSplit } = useExpenseDraft();
  const isSiteManager = getSession()?.user.role === "Site Manager";

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [projectsById, setProjectsById] = useState<
    Record<string, Project>
  >({});
  const [filter, setFilter] = useState<FilterKey>(isSiteManager ? "Completed" : "Pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("due");
  const [scans, setScans] = useState<ReceiptScan[]>([]);
  const [focused, setFocused] = useState(false);
  // Offline-first: when the lists on screen are the copy saved on this phone.
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // Receipts saved on this phone, waiting to be uploaded for reading.
  const [queuedScans, setQueuedScans] = useState<QueuedScan[]>([]);
  const refreshQueuedScans = useCallback(() => {
    const userId = getSession()?.user.id ?? null;
    setQueuedScans([...getPendingScans(userId), ...getRejectedScans(userId)] as QueuedScan[]);
  }, []);

  // Background scans. A failure here must not hide the tickets.
  const loadScans = useCallback(async () => {
    try {
      setScans((await loadScansCached()).data);
    } catch {
      // Keep whatever was shown; the next refresh tries again.
    }
  }, []);

  const load = useCallback(async () => {
    setError(null);

    try {
      const [ticketResult, projectResult] = await Promise.all([
        loadAssignedTickets(isSiteManager ? "Site Manager" : "Purchaser"),
        loadActiveProjects(),
      ]);
      const ticketList = ticketResult.data;
      const projectList = projectResult.data;
      setSavedAt(ticketResult.fromCache ? ticketResult.savedAt : null);

      const byId: Record<string, Project> = {};

      for (const p of projectList) {
        byId[p.projectid] = p;
      }

      setProjectsById(byId);
      setTickets(ticketList);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("errors.something")
      );
    } finally {
      setLoading(false);
    }
  }, [isSiteManager]);

  // A pop-up just announced something new (e.g. the PM reviewed a task).
  useOnNewNotifications(() => { load(); });

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      load();
      loadScans();
      refreshQueuedScans();
      return () => setFocused(false);
    }, [load, loadScans, refreshQueuedScans])
  );

  // Offline: keep what was loaded last and never show a server error (the banner
  // already says "offline"). Reload by itself on reconnect.
  const { isOnline, pendingCount, lastSync } = useNetwork();
  // A sync just ran (receipts may have been uploaded): refresh both lists.
  useEffect(() => {
    refreshQueuedScans();
    if (lastSync?.result?.scans?.uploaded) loadScans();
  }, [pendingCount, lastSync, refreshQueuedScans, loadScans]);
  const wasOnline = React.useRef(isOnline);
  useEffect(() => {
    if (isOnline && !wasOnline.current) {
      load();
      loadScans();
    }
    wasOnline.current = isOnline;
  }, [isOnline, load, loadScans]);
  const shownError = describeLoadError(error, isOnline);

  // Keep "Reading…" rows moving to "Review" without a manual pull-to-refresh.
  const anyScanning = scans.some((scan) => scan.status === "Scanning");
  useEffect(() => {
    if (!focused || !anyScanning) return;
    const timer = setInterval(loadScans, SCAN_REFRESH_MS);
    return () => clearInterval(timer);
  }, [focused, anyScanning, loadScans]);

  function removeScan(scan: ReceiptScan) {
    setScans((prev) => prev.filter((s) => s.scanID !== scan.scanID));
    dismissScan(scan.scanID).catch(() => loadScans());
  }

  const actionable = tickets.filter((t) => isSiteManager
    ? t.status === "Resolved" && t.tickettype === "Material Request"
    : toBucket(t.status) !== null);

  const filterLabels: Record<FilterKey, string> = isSiteManager
    ? { All: t("common.all"), Pending: t("common.pending"), Completed: t("common.completed") }
    : { All: t("common.all"), Pending: t("mobile.assigned"), Completed: t("mobile.purchased") };

  const visible = actionable
    .filter((t) => filter === "All" || toBucket(t.status) === filter)
    .sort((a, b) => {
      const newest = new Date(b.createdat).getTime() - new Date(a.createdat).getTime();
      if (isSiteManager || sort === "newest") return newest;
      // Earliest due date first; requests with no date go last.
      const due = dueSortKey(a.neededby) - dueSortKey(b.neededby);
      return Number.isNaN(due) || due === 0 ? newest : due;
    });

  const counts = {
    All: actionable.length,
    Pending: actionable.filter((t) => toBucket(t.status) === "Pending").length,
    Completed: actionable.filter((t) => toBucket(t.status) === "Completed").length,
  };

  // Sum of the estimates of the requests listed below.
  const estimatedTotal = visible.reduce((sum, t) => sum + Number(t.approvedbudget ?? 0), 0);

  function openTicket(ticket: Ticket) {
    reset();

    const project = projectsById[ticket.projectid];

    setTicket({
      ticketId: ticket.ticketid,
      projectId: ticket.projectid,
      projectName: project?.name ?? t("mr.unknown_project"),
      subject: ticket.subject,
      budget: ticket.approvedbudget == null ? undefined : String(ticket.approvedbudget),
    });

    router.push("/expense/capture");
  }

  return (
    // The tab layout's header already sits under the status bar and its tab bar
    // (Purchaser) or Site Manager bottom bar handles the bottom inset.
    <SafeAreaView style={[styles.safeArea, isSiteManager && styles.safeAreaWarm]} edges={[]}>
      <View style={styles.header}>
        <Text style={styles.brand}>{t(isSiteManager ? "mobile.ready_for_expense" : "mobile.requests")}</Text>
        <Text style={styles.subtitle}>
          {isSiteManager
            ? t("mobile.material_requests_help")
            : t("mobile.materials_assigned")}
        </Text>
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
            <Text style={[styles.pillText, filter === key && styles.pillTextActive]}>
              {filterLabels[key]} ({counts[key]})
            </Text>
          </Pressable>
        ))}
      </View>

      {(!isOnline || savedAt) && (
        <Text style={styles.offlineNote}>
          {savedAt
            ? t("ix.offline_saved_reqs", { reason: isOnline ? t("sm.cant_reach") : t("mx.offline_title"), when: savedAtLabel(savedAt, new Date(), t) })
            : t("ix.offline_last")}
        </Text>
      )}

      {shownError && (
        <View style={styles.stateWrap}>
          <StateCard kind="error" title={t("mobile.requests_load_error")} body={shownError} onRetry={load} />
        </View>
      )}

      <FlatList
        data={visible}
        keyExtractor={(t) => t.ticketid}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
          <ScannedReceipts
            scans={scans}
            onDismiss={removeScan}
            queued={queuedScans}
            onRemoveQueued={(row) => {
              deleteQueuedPhoto(removeQueuedScan(row.scan_id));
              refreshQueuedScans();
            }}
          />
          {isSiteManager ? (
            <Pressable
              onPress={() => { reset(); startSplit(); router.push("/expense/capture"); }}
              style={styles.splitButton}
              accessibilityRole="button"
            >
              <Text style={styles.splitButtonText}>{t("sm.snap_many")}</Text>
              <Text style={styles.splitButtonHelp}>{t("sm.snap_many_help")}</Text>
            </Pressable>
          ) : (
            <View style={styles.listHeaderRow}>
              <View style={styles.flex}>
                <Text style={styles.sectionTitle}>{t(filter === "Completed" ? "mobile.purchased_section" : "mobile.to_purchase")}</Text>
                <Text style={styles.sectionTotal}>{formatPeso(estimatedTotal)} {t("mobile.estimated_total")}</Text>
              </View>
              <Pressable
                onPress={() => setSort((current) => (current === "due" ? "newest" : "due"))}
                style={styles.sortButton}
                accessibilityRole="button"
                accessibilityLabel={`${t("mobile.sorted_by")} ${t(sort === "due" ? "mobile.due_date" : "mobile.newest")}. ${t("mobile.tap_to_change")}`}
              >
                <Text style={styles.sortText}>{t(sort === "due" ? "mobile.due_date" : "mobile.newest")} ↓</Text>
              </Pressable>
            </View>
          )}
          </>
        }
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => { load(); loadScans(); }}
          />
        }
        ListEmptyComponent={
          !loading ? (
            <StateCard
              kind="empty"
              title={t(isSiteManager ? "mobile.no_capture_requests" : "mobile.no_requests_view")}
              body={
                isSiteManager
                  ? t("mobile.no_requests_capture_help")
                  : t("mobile.no_requests_assigned")
              }
            />
          ) : null
        }
        renderItem={({ item }) => {
          const project = projectsById[item.projectid];
          const actionableNow = isSiteManager
            ? item.status === "Resolved" && item.tickettype === "Material Request"
            : item.status === "Acknowledged";

          // Non-blocking signal only — a ticket CAN have more than one
          // expense, so this never hides the action, just relabels it so
          // nobody captures a second one by accident.
          const expenseCount = Number(item.expensecount || 0);
          const alreadyCaptured = expenseCount > 0;

          const quantityLine = item.quantity != null
            ? `${formatQty(Number(item.quantity))}${item.unit ? ` ${item.unit}` : ""}`
            : null;
          const urgency = urgencyFor(item.neededby, new Date(), t, intlLocale);

          let chip: { label: string; tone: ChipTone };
          if (item.status === "Resolved") chip = { label: t("mobile.purchased"), tone: "success" };
          else if (alreadyCaptured) chip = { label: t("common.in_progress"), tone: "info" };
          else chip = { label: t("mobile.to_purchase"), tone: "primary" };

          const Card = (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardType}>{item.tickettype}</Text>
                <StatusChip label={chip.label} tone={chip.tone} />
              </View>

              <Text style={styles.cardTitle} numberOfLines={2}>{item.subject}</Text>
              {quantityLine ? <Text style={styles.cardQuantity}>{quantityLine}</Text> : null}

              <View style={styles.divider} />

              <Text style={styles.cardLocation} numberOfLines={1}>{project?.name ?? t("mr.unknown_project")}</Text>

              {alreadyCaptured && (
                <Text style={styles.capturedNote}>
                  {expenseCount === 1 ? t("mr.captured_one", { total: `₱${Number(item.expensetotal || 0).toLocaleString()}` }) : t("mr.captured_other", { count: expenseCount, total: `₱${Number(item.expensetotal || 0).toLocaleString()}` })}
                </Text>
              )}

              {isSiteManager ? (
                <View style={styles.cardFooterRow}>
                  <Text style={styles.cardFooterText}>{new Date(item.createdat).toLocaleDateString()}</Text>
                  <AppButton
                    label={t(alreadyCaptured ? "mobile.add_another_expense" : "mobile.add_expense")}
                    variant={alreadyCaptured ? "secondary" : "primary"}
                    fit
                    onPress={() => openTicket(item)}
                  />
                </View>
              ) : (
                <View style={styles.cardFooterRow}>
                  <View style={styles.urgencyRow}>
                    <IconSymbol name="calendar" size={14} color={URGENCY_COLOR[urgency.tone]} />
                    <Text style={[styles.urgencyText, { color: URGENCY_COLOR[urgency.tone] }]} numberOfLines={1}>
                      {urgency.label}
                    </Text>
                  </View>
                  {item.approvedbudget != null && (
                    <Text style={styles.estimate}>{formatPeso(item.approvedbudget)} est.</Text>
                  )}
                </View>
              )}
            </View>
          );

          // The whole card is the tap target when there is something to do.
          return actionableNow ? (
            <Pressable
              onPress={() => openTicket(item)}
              style={({ pressed }) => pressed && styles.pressed}
              accessibilityRole="button"
              accessibilityLabel={`${item.subject}, ${chip.label}. ${t("mobile.capture_expense")}`}
            >
              {Card}
            </Pressable>
          ) : (
            Card
          );
        }}
      />

      {isSiteManager ? null : <ExpenseActions />}
    </SafeAreaView>
  );
}

const URGENCY_COLOR = {
  late: COLORS.errorText,
  today: COLORS.errorText,
  soon: COLORS.amberText,
  normal: COLORS.muted,
  none: COLORS.muted,
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  safeAreaWarm: { backgroundColor: COLORS.bgWarm },
  stateWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  flex: { flex: 1 },
  pressed: { opacity: 0.85 },

  header: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  brand: { fontSize: 26, fontFamily: FONT.extrabold, color: COLORS.heading },
  subtitle: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 2 },

  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  pill: { minHeight: MIN_TAP, justifyContent: "center", paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: COLORS.inputBorder, backgroundColor: COLORS.card },
  pillActive: { backgroundColor: COLORS.primaryTint, borderColor: COLORS.primary },
  pillText: { fontSize: 13, fontFamily: FONT.semibold, color: COLORS.muted },
  pillTextActive: { color: COLORS.primaryTintText, fontFamily: FONT.bold },

  offlineNote: { color: COLORS.amberBannerText, backgroundColor: COLORS.amberBannerFill, marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 10, fontSize: 12, fontFamily: FONT.medium },

  list: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },

  listHeaderRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  sectionTitle: { fontSize: 16, fontFamily: FONT.extrabold, color: COLORS.heading },
  sectionTotal: { fontSize: 12, fontFamily: FONT.medium, color: COLORS.muted, marginTop: 1 },
  splitButton: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 14, gap: 2, minHeight: MIN_TAP, marginBottom: 12 },
  splitButtonText: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.primaryTintText },
  splitButtonHelp: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted },
  sortButton: { minHeight: MIN_TAP, justifyContent: "center", paddingHorizontal: 8 },
  sortText: { fontSize: 13, fontFamily: FONT.semibold, color: COLORS.primary },

  card: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 14 },
  cardHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 },
  cardType: { flexShrink: 1, fontSize: 11, fontFamily: FONT.bold, color: COLORS.muted },
  cardTitle: { fontSize: 19, fontFamily: FONT.extrabold, color: COLORS.heading },
  cardQuantity: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 2 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 10 },
  cardLocation: { fontSize: 13, fontFamily: FONT.medium, color: COLORS.heading, marginBottom: 8 },
  capturedNote: { fontSize: 11, fontFamily: FONT.bold, color: COLORS.success, marginBottom: 8 },

  cardFooterRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  cardFooterText: { fontSize: 11, fontFamily: FONT.regular, color: COLORS.muted },
  urgencyRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  urgencyText: { flexShrink: 1, fontSize: 12, fontFamily: FONT.bold },
  estimate: { fontSize: 16, fontFamily: FONT.extrabold, color: COLORS.primary },

});
