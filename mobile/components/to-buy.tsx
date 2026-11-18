import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";

import { remainingBudgetText } from "@/lib/budget-check";
import { quantityFieldsFromRequest, quantityFieldsFromTicket } from "@/lib/request-progress";
import { type OpenRequest, type Project, type Ticket } from "@/lib/api";
import { loadActiveProjects, loadAssignedTickets, loadOpenRequests, loadScans as loadScansCached } from "@/lib/cached-api";
import { otherRequests, progressOf } from "@/lib/to-buy";
import { filterByProject, groupByProject } from "@/lib/project-groups";
import { useExpenseDraft } from "@/lib/expense-draft-context";
import { useOnNewNotifications } from "@/lib/notification-events";
import { describeLoadError } from "@/lib/sync/messages";
import { savedAtLabel } from "@/lib/sync/offline-cache";
import { useNetwork } from "@/lib/sync/network-context";
import { formatPeso, formatQty } from "@/lib/money";
import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { AppButton } from "@/components/app-button";
import { StateCard } from "@/components/state-card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useLocale } from "@/lib/i18n-context";
import { getSession } from "@/lib/auth";
import { ScannedReceipts, type QueuedScan } from "@/components/scanned-receipts";
import { RequestDetailsSheet } from "@/components/request-details-sheet";
import { PurchaseOrderSheet } from "@/components/purchase-order-sheet";
import { dismissScan, type ReceiptScan } from "@/lib/receipt-scans";
import { getPendingScans, getRejectedScans, removeQueuedScan } from "@/lib/sync/db";
import { deleteQueuedPhoto } from "@/lib/sync/task-photo";

// While a receipt is still being read, refresh the list this often.
const SCAN_REFRESH_MS = 4000;

// The Purchaser's morning list: what to buy today, grouped by the store each request
// asked for, so the list reads as a shopping route. One button per store opens the camera.
// A Site Manager sees the same screen for the projects they manage; with no Turn In tab,
// their scanned receipts are listed here too, and closing a request short stays with the Purchaser.
export function ToBuy() {
  const { t, intlLocale } = useLocale();
  const { isOnline, pendingCount, lastSync } = useNetwork();
  const isSiteManager = getSession()?.user.role === "Site Manager";
  const { reset, setTicket, startSplit } = useExpenseDraft();

  const [requests, setRequests] = useState<OpenRequest[]>([]);
  const [assigned, setAssigned] = useState<Ticket[]>([]);
  const [projectsById, setProjectsById] = useState<Record<string, Project>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Offline-first: when the list on screen is the copy saved on this phone.
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // The request whose details sheet is open (tap a request to open it).
  const [detail, setDetail] = useState<OpenRequest | null>(null);
  // "Which request is this receipt for?" sheet, opened by the Snap receipt button.
  // "Purchase order" sheet: a printable list of what to buy, per project.
  const [poOpen, setPoOpen] = useState(false);
  const [poProjectId, setPoProjectId] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  // Site Manager only: receipts being read or ready to review, and ones saved on this phone offline.
  const [scans, setScans] = useState<ReceiptScan[]>([]);
  const [queuedScans, setQueuedScans] = useState<QueuedScan[]>([]);
  const [focused, setFocused] = useState(false);

  const refreshQueuedScans = useCallback(() => {
    if (!isSiteManager) return;
    const userId = getSession()?.user.id ?? null;
    setQueuedScans([...getPendingScans(userId), ...getRejectedScans(userId)] as QueuedScan[]);
  }, [isSiteManager]);

  // A failure here must not hide the requests.
  const loadScans = useCallback(async () => {
    if (!isSiteManager) return;
    try {
      setScans((await loadScansCached()).data);
    } catch {
      // Keep whatever was shown; the next refresh tries again.
    }
  }, [isSiteManager]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [openResult, ticketResult, projectResult] = await Promise.all([
        loadOpenRequests(),
        isSiteManager ? Promise.resolve({ data: [] as Ticket[] }) : loadAssignedTickets("Purchaser"),
        loadActiveProjects(),
      ]);
      setRequests(openResult.data);
      setAssigned(ticketResult.data);
      setProjectsById(Object.fromEntries(projectResult.data.map((p) => [p.projectid, p])));
      setSavedAt(openResult.fromCache ? openResult.savedAt : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.something"));
    } finally {
      setLoading(false);
    }
  }, [isSiteManager]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      load();
      loadScans();
      refreshQueuedScans();
      return () => setFocused(false);
    }, [load, loadScans, refreshQueuedScans])
  );
  // The PM just acknowledged a request or acted on a receipt.
  useOnNewNotifications(() => { load(); });

  // A sync just ran (offline receipts may have been uploaded), or the phone came back online.
  useEffect(() => {
    refreshQueuedScans();
    if (lastSync?.result?.scans?.uploaded) loadScans();
  }, [pendingCount, lastSync, refreshQueuedScans, loadScans]);
  const wasOnline = useRef(isOnline);
  useEffect(() => {
    if (isOnline && !wasOnline.current) {
      load();
      loadScans();
    }
    wasOnline.current = isOnline;
  }, [isOnline, load, loadScans]);

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

  const shownError = describeLoadError(error, isOnline);
  const others = useMemo(() => otherRequests(assigned, requests), [assigned, requests]);

  // One project at a time suits a delivery run; "All" keeps the shopping route.
  const projectChoices = useMemo(
    () => groupByProject(requests, (r: OpenRequest) => ({ id: r.projectID, name: r.projectName, at: r.createdAt })),
    [requests]
  );
  const activeFilter = projectChoices.some((p) => p.projectId === projectFilter) ? projectFilter : null;
  const filtered = useMemo(() => filterByProject(requests, activeFilter) as OpenRequest[], [requests, activeFilter]);
  const sections = useMemo(
    () =>
      groupByProject(filtered, (r: OpenRequest) => ({ id: r.projectID, name: r.projectName, at: r.createdAt })).map((g) => ({
        key: g.projectId,
        title: g.projectName,
        requests: g.items as OpenRequest[],
      })),
    [filtered]
  );

  function projectNameOf(ticket: Ticket) {
    return ticket.projectname ?? projectsById[ticket.projectid]?.name ?? t("mr.unknown_project");
  }

  // Straight to Add receipt. The Purchaser does not say which request or project the receipt is for:
  // they scan it, and after it is read the app matches it to the open requests that have those materials.
  function startSnap() {
    reset();
    startSplit(null);
    router.push("/expense/capture");
  }

  // "Snap receipt for this request" in the details sheet: the receipt goes to this
  // one request (single mode), the same way an item under "Other" works.
  function snapForRequest(request: OpenRequest) {
    setDetail(null);
    reset();
    setTicket({
      ticketId: request.ticketID,
      projectId: request.projectID,
      projectName: request.projectName,
      subject: request.subject,
      budget: request.approvedBudget == null ? undefined : String(request.approvedBudget),
      // What is left of the budget: the receipt cannot go over this.
      remaining: request.remainingBudget == null ? undefined : String(request.remainingBudget),
      ...quantityFieldsFromRequest(request),
    });
    router.push("/expense/capture");
  }

  function openOther(ticket: Ticket) {
    reset();
    setTicket({
      ticketId: ticket.ticketid,
      projectId: ticket.projectid,
      projectName: projectNameOf(ticket),
      subject: ticket.subject,
      budget: ticket.approvedbudget == null ? undefined : String(ticket.approvedbudget),
      remaining: remainingBudgetText(ticket),
      ...quantityFieldsFromTicket(ticket),
    });
    router.push("/expense/capture");
  }

  // Opens the purchase order sheet. From a project's header that project is already ticked; from the
  // button next to Snap receipt it starts with the project the list is filtered to (or all of them).
  function openPurchaseOrder(projectId: string | null) {
    setPoProjectId(projectId ?? activeFilter);
    setPoOpen(true);
  }

  const empty = !loading && sections.length === 0 && others.length === 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { load(); loadScans(); }} />}
      >
        <Text style={styles.title}>{t("tb.title")}</Text>
        <Text style={styles.subtitle}>{t("tb.subtitle")}</Text>

        {(!isOnline || savedAt) && (
          <Text style={styles.offlineNote}>
            {savedAt
              ? t("ix.offline_saved_reqs", { reason: isOnline ? t("sm.cant_reach") : t("mx.offline_title"), when: savedAtLabel(savedAt, new Date(), t, intlLocale) })
              : t("ix.offline_last")}
          </Text>
        )}

        {/* What is left to buy, at a glance (same orange card as the Site Manager's Tasks). */}
        <View style={styles.heroCard}>
          <View style={styles.heroTile}>
            <IconSymbol name="list.clipboard.fill" size={34} color={COLORS.primary} />
          </View>
          <View style={styles.heroBody}>
            <Text style={styles.heroLabel}>{t("tb.hero_label")}</Text>
            <Text style={styles.heroValue}>
              {loading && requests.length === 0
                ? "…"
                : `${t(requests.length === 1 ? "tb.items_one" : "tb.items_other", { count: requests.length })} · ${t(projectChoices.length === 1 ? "tb.projects_one" : "tb.projects_other", { count: projectChoices.length })}`}
            </Text>
          </View>
        </View>

        {/* The two things a buyer does: snap a receipt, or print what to buy. */}
        <View style={styles.actionRow}>
          <AppButton label={t("tb.snap")} onPress={startSnap} style={styles.actionPrimary} />
          {requests.length > 0 ? (
            <AppButton label={t("po.button")} variant="secondary" onPress={() => openPurchaseOrder(null)} style={styles.actionSecondary} />
          ) : null}
        </View>

        {/* One project at a time suits a delivery run; "All projects" keeps the whole list. */}
        {projectChoices.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {[{ id: null as string | null, label: t("tb.all_projects"), count: requests.length },
              ...projectChoices.map((p) => ({ id: p.projectId as string | null, label: p.projectName, count: p.count }))].map((option) => {
              const active = activeFilter === option.id;
              return (
                <Pressable
                  key={option.id ?? "all"}
                  onPress={() => setProjectFilter(option.id)}
                  style={[styles.chip, active && styles.chipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{option.label}</Text>
                  <View style={[styles.chipCount, active && styles.chipCountActive]}>
                    <Text style={[styles.chipCountText, active && styles.chipTextActive]}>{option.count}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {isSiteManager ? (
          <ScannedReceipts
            scans={scans}
            onDismiss={removeScan}
            queued={queuedScans}
            onRemoveQueued={(row) => {
              deleteQueuedPhoto(removeQueuedScan(row.scan_id));
              refreshQueuedScans();
            }}
          />
        ) : null}

        {shownError && <StateCard kind="error" title={t("mobile.requests_load_error")} body={shownError} onRetry={load} />}

        {sections.map((group) => (
          <View key={group.key} style={styles.group}>
            <View style={styles.groupHeader}>
              <Text style={styles.groupTitle} numberOfLines={2}>{group.title}</Text>
              <View style={styles.groupCountPill}>
                <Text style={styles.groupCount}>{t(group.requests.length === 1 ? "tb.items_one" : "tb.items_other", { count: group.requests.length })}</Text>
              </View>
              <Pressable
                onPress={() => openPurchaseOrder(group.key)}
                style={({ pressed }) => [styles.groupPoButton, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel={t("po.for_project", { project: group.title })}
                hitSlop={6}
              >
                <IconSymbol name="list.clipboard.fill" size={20} color={COLORS.primary} />
              </Pressable>
            </View>

            {group.requests.map((request) => {
              const progress = progressOf(request);
              const unit = request.materialType;
              return (
                <Pressable
                  key={request.ticketID}
                  onPress={() => setDetail(request)}
                  style={({ pressed }) => [styles.request, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityHint={t("rd.open_hint")}
                >
                  <View style={styles.requestHead}>
                    <Text style={[styles.requestTitle, styles.requestTitleInRow]} numberOfLines={2}>
                      {request.subject}
                    </Text>
                    <IconSymbol name="chevron.right" size={20} color={COLORS.muted} />
                  </View>
                  <Text style={styles.requestMeta} numberOfLines={1}>
                    {t("tb.need_line_plain", { quantity: formatQty(request.requestedQuantity), material: unit })}
                  </Text>
                  {progress.started ? (
                    <>
                      <View style={styles.track} accessibilityRole="progressbar">
                        <View style={[styles.fill, { width: `${Math.round((progress.quantityShare ?? 0) * 100)}%` }]} />
                      </View>
                      <Text style={styles.progressText}>
                        {t("tb.progress_qty", { bought: formatQty(progress.bought), total: formatQty(progress.requested) })}
                        {progress.spent != null && progress.budget != null
                          ? ` · ${t("tb.spent_of", { spent: formatPeso(progress.spent), budget: formatPeso(progress.budget) })}`
                          : ""}
                      </Text>
                    </>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}

        {others.length > 0 && (
          <View style={styles.group}>
            <Text style={styles.groupTitle}>{t("tb.other_title")}</Text>
            {others.map((ticket) => (
              <Pressable
                key={ticket.ticketid}
                onPress={() => openOther(ticket)}
                style={({ pressed }) => [styles.request, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel={`${ticket.subject}. ${t("mobile.capture_expense")}`}
              >
                <Text style={styles.requestTitle} numberOfLines={2}>{ticket.subject}</Text>
                <Text style={styles.requestMeta} numberOfLines={1}>
                  {projectNameOf(ticket)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {empty && <StateCard kind="empty" title={t("tb.empty_title")} body={t("tb.empty_body")} />}
      </ScrollView>

      {/* Site Managers see the details too; filing a receipt for one request stays the Purchaser's. */}
      <RequestDetailsSheet request={detail} canSnap onSnap={snapForRequest} onClose={() => setDetail(null)} />

      <PurchaseOrderSheet
        visible={poOpen}
        requests={requests}
        initialProjectId={poProjectId}
        onClose={() => setPoOpen(false)}
      />
    </SafeAreaView>
  );
}

// The Site Manager's look: warm page, white cards with a 16px radius, one orange accent.
const CARD = { backgroundColor: COLORS.card, borderColor: COLORS.border, borderRadius: 16, borderWidth: 1 } as const;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bgWarm },
  content: { paddingHorizontal: 20, paddingBottom: 28, gap: 14 },

  title: { color: COLORS.heading, fontSize: 28, fontFamily: FONT.extrabold, letterSpacing: -0.5, marginTop: 14 },
  subtitle: { fontFamily: FONT.regular, color: COLORS.muted, fontSize: 15, marginTop: -8 },
  offlineNote: { color: COLORS.amberBannerText, backgroundColor: COLORS.amberBannerFill, padding: 12, borderRadius: 12, fontSize: 13, lineHeight: 18, fontFamily: FONT.regular },

  heroCard: { alignItems: "center", backgroundColor: COLORS.primary, borderRadius: 24, flexDirection: "row", gap: 16, padding: 16 },
  heroTile: { alignItems: "center", backgroundColor: COLORS.card, borderRadius: 18, height: 68, justifyContent: "center", width: 68 },
  heroBody: { flex: 1 },
  heroLabel: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontFamily: FONT.medium },
  heroValue: { color: "#FFFFFF", fontSize: 21, fontFamily: FONT.extrabold, marginTop: 3 },

  actionRow: { flexDirection: "row", gap: 10 },
  actionPrimary: { flex: 1.25 },
  actionSecondary: { flex: 1 },

  chipRow: { gap: 8, paddingRight: 4 },
  chip: { alignItems: "center", backgroundColor: COLORS.card, borderColor: COLORS.border, borderRadius: 22, borderWidth: 1, flexDirection: "row", gap: 8, maxWidth: 240, minHeight: MIN_TAP, paddingHorizontal: 14 },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.heading, flexShrink: 1, fontSize: 13, fontFamily: FONT.bold },
  chipTextActive: { color: "#FFFFFF" },
  chipCount: { backgroundColor: COLORS.primaryTint, borderRadius: 10, minWidth: 20, paddingHorizontal: 6, paddingVertical: 1 },
  chipCountActive: { backgroundColor: "rgba(255,255,255,0.28)" },
  chipCountText: { color: COLORS.primaryTintText, fontSize: 12, fontFamily: FONT.extrabold, textAlign: "center" },

  // One white card per project: its name, how many items, the Purchase order button, then its requests.
  group: { ...CARD, padding: 14, gap: 12 },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  groupTitle: { flex: 1, fontSize: 17, fontFamily: FONT.extrabold, color: COLORS.heading },
  groupCountPill: { backgroundColor: COLORS.primaryTint, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  groupCount: { fontSize: 12, fontFamily: FONT.extrabold, color: COLORS.primaryTintText },
  groupPoButton: { width: MIN_TAP - 4, height: MIN_TAP - 4, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.primaryTint },

  request: { gap: 4, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 12, minHeight: MIN_TAP },
  requestHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  requestTitle: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.heading },
  requestTitleInRow: { flex: 1 },
  requestMeta: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted },
  track: { height: 6, borderRadius: 3, backgroundColor: COLORS.border, overflow: "hidden", marginTop: 4 },
  fill: { height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  progressText: { fontSize: 12, fontFamily: FONT.semibold, color: COLORS.muted },
});