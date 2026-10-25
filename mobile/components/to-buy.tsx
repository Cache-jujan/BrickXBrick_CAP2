import React, { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";

import { closeShortRequest, type OpenRequest, type Project, type Ticket } from "@/lib/api";
import { loadActiveProjects, loadAssignedTickets, loadOpenRequests } from "@/lib/cached-api";
import { filterByVendor, groupByVendor, otherRequests, progressOf, vendorOptions } from "@/lib/to-buy";
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
import { ProjectDropdown } from "@/components/project-dropdown";
import { SnapProjectSheet } from "@/components/snap-project-sheet";
import { useLocale } from "@/lib/i18n-context";

// The Purchaser's morning list: what to buy today, grouped by the store each request
// asked for, so the list reads as a shopping route. One button per store opens the camera.
export function ToBuy() {
  const { t } = useLocale();
  const { isOnline } = useNetwork();
  const { reset, setTicket, startSplit } = useExpenseDraft();

  const [requests, setRequests] = useState<OpenRequest[]>([]);
  const [assigned, setAssigned] = useState<Ticket[]>([]);
  const [projectsById, setProjectsById] = useState<Record<string, Project>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Offline-first: when the list on screen is the copy saved on this phone.
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // The request whose "close, that's all I could buy" reasons are showing.
  const [closingId, setClosingId] = useState<string | null>(null);
  const [view, setView] = useState<"store" | "project">("store");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  // "Which project is this receipt for?" sheet, opened by Snap receipt while no project is picked.
  const [sheetOpen, setSheetOpen] = useState(false);
  // By store: show one store only (the store key; null = all stores).
  const [vendorFilter, setVendorFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [openResult, ticketResult, projectResult] = await Promise.all([
        loadOpenRequests(),
        loadAssignedTickets("Purchaser"),
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
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  // The PM just acknowledged a request or acted on a receipt.
  useOnNewNotifications(() => { load(); });

  const shownError = describeLoadError(error, isOnline);
  const others = useMemo(() => otherRequests(assigned, requests), [assigned, requests]);

  // One project at a time suits a delivery run; "All" keeps the shopping route.
  const projectChoices = useMemo(
    () => groupByProject(requests, (r: OpenRequest) => ({ id: r.projectID, name: r.projectName, at: r.createdAt })),
    [requests]
  );
  // The project filter belongs to By project; By store has the store filter only.
  const activeFilter = view === "project" && projectChoices.some((p) => p.projectId === projectFilter) ? projectFilter : null;
  const storeChoices = useMemo(() => vendorOptions(requests), [requests]);
  const activeVendor = storeChoices.some((s) => s.key === vendorFilter) ? vendorFilter : null;
  const filtered = useMemo(() => {
    return view === "store"
      ? (filterByVendor(requests, activeVendor) as OpenRequest[])
      : (filterByProject(requests, activeFilter) as OpenRequest[]);
  }, [requests, activeFilter, activeVendor, view]);
  const sections = useMemo(() => {
    if (view === "project") {
      return groupByProject(filtered, (r: OpenRequest) => ({ id: r.projectID, name: r.projectName, at: r.createdAt })).map((g) => ({
        key: g.projectId,
        title: g.projectName,
        requests: g.items as OpenRequest[],
      }));
    }
    return groupByVendor(filtered).map((g) => ({
      key: g.key || "any",
      // Requests with no store asked for are only in "All stores".
      title: g.vendorName ?? t("tb.all_stores"),
      requests: g.requests as OpenRequest[],
    }));
  }, [filtered, view, t]);

  function projectNameOf(ticket: Ticket) {
    return ticket.projectname ?? projectsById[ticket.projectid]?.name ?? t("mr.unknown_project");
  }

  // Opens the camera. The receipt is not tied to a request here: the app matches
  // it to the open requests afterwards.
  function snapReceipt(project: { id: string; name: string } | null) {
    reset();
    startSplit(project ? { projectIds: [project.id], projectNames: [project.name] } : null);
    router.push("/expense/capture");
  }

  // Gas, toll and other trip costs have no request: the photo goes to Turn In tagged as a trip cost.
  function snapGas() {
    reset();
    startSplit({ kind: "trip" });
    router.push("/expense/capture");
  }

  // The pinned button: straight to the camera when a project is picked, otherwise ask which.
  function snapFromFooter() {
    const picked = projectChoices.find((p) => p.projectId === activeFilter);
    if (picked) return snapReceipt({ id: picked.projectId, name: picked.projectName });
    if (projectChoices.length <= 1) {
      // One project (or none yet): nothing to ask.
      const only = projectChoices[0];
      return snapReceipt(only ? { id: only.projectId, name: only.projectName } : null);
    }
    setSheetOpen(true);
  }

  // The money or the stock ran out: close what is left, with a reason the PM can read.
  // The reason is saved in English because the Project Manager reads it.
  function closeShort(request: OpenRequest, reason: string) {
    if (!isOnline) return Alert.alert(t("mx.offline_title"), t("ck.close_offline"));
    Alert.alert(t("ck.close_title"), reason, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("ck.close_short"),
        style: "destructive",
        onPress: async () => {
          try {
            await closeShortRequest(request.ticketID, reason);
            setClosingId(null);
            load();
          } catch {
            Alert.alert(t("ck.close_failed"));
          }
        },
      },
    ]);
  }

  function openOther(ticket: Ticket) {
    reset();
    setTicket({
      ticketId: ticket.ticketid,
      projectId: ticket.projectid,
      projectName: projectNameOf(ticket),
      subject: ticket.subject,
      budget: ticket.approvedbudget == null ? undefined : String(ticket.approvedbudget),
    });
    router.push("/expense/capture");
  }

  const empty = !loading && sections.length === 0 && others.length === 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t("tb.title")}</Text>
          <Text style={styles.subtitle}>{t("tb.subtitle")}</Text>
        </View>

        {(!isOnline || savedAt) && (
          <Text style={styles.offlineNote}>
            {savedAt
              ? t("ix.offline_saved_reqs", { reason: isOnline ? t("sm.cant_reach") : t("mx.offline_title"), when: savedAtLabel(savedAt, new Date(), t) })
              : t("ix.offline_last")}
          </Text>
        )}

        {shownError && <StateCard kind="error" title={t("mobile.requests_load_error")} body={shownError} onRetry={load} />}

        {(projectChoices.length > 1 || storeChoices.length > 1) && (
          <View style={styles.controls}>
            <View style={styles.segment}>
              {(["store", "project"] as const).map((mode) => (
                <Pressable
                  key={mode}
                  onPress={() => setView(mode)}
                  style={[styles.segmentItem, view === mode && styles.segmentOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: view === mode }}
                >
                  <Text style={[styles.segmentText, view === mode && styles.segmentTextOn]}>
                    {t(mode === "store" ? "tb.view_store" : "tb.view_project")}
                  </Text>
                </Pressable>
              ))}
            </View>
            {view === "store" && storeChoices.length > 1 ? (
              <ProjectDropdown
                label={t("tb.filter_store")}
                allLabel={t("tb.all_stores")}
                options={storeChoices.map((s) => ({ id: s.key, label: s.vendorName ?? "" }))}
                value={activeVendor}
                onChange={setVendorFilter}
              />
            ) : null}
            {view === "project" && projectChoices.length > 1 ? (
              <ProjectDropdown
                label={t("tb.filter_project")}
                allLabel={t("tb.all_projects")}
                options={projectChoices.map((p) => ({ id: p.projectId, label: p.projectName }))}
                value={activeFilter}
                onChange={setProjectFilter}
              />
            ) : null}
          </View>
        )}

        {sections.length > 0 && (view === "store" ? activeVendor === null : activeFilter === null) ? (
          <View style={styles.allBanner} accessibilityRole="header">
            <IconSymbol name="folder.fill" size={20} color={SOFT.text} />
            <Text style={styles.allBannerTitle} numberOfLines={1}>{t(view === "store" ? "tb.all_stores" : "tb.all_projects")}</Text>
            <Text style={styles.allBannerCount}>
              {t(filtered.length === 1 ? "tb.items_one" : "tb.items_other", { count: filtered.length })}
            </Text>
          </View>
        ) : null}

        {sections.map((group) => (
          <View key={group.key} style={styles.group}>
            <View style={styles.groupHeader}>
              <Text style={styles.groupTitle} numberOfLines={2}>{group.title}</Text>
              <View style={styles.groupCountPill}>
                <Text style={styles.groupCount}>{t(group.requests.length === 1 ? "tb.items_one" : "tb.items_other", { count: group.requests.length })}</Text>
              </View>
            </View>

            {group.requests.map((request) => {
              const progress = progressOf(request);
              const unit = request.materialType;
              return (
                <View key={request.ticketID} style={styles.request}>
                  <Text style={styles.requestTitle} numberOfLines={2}>
                    {request.subject}
                  </Text>
                  <Text style={styles.requestMeta} numberOfLines={1}>
                    {t("tb.need_line", { quantity: formatQty(request.requestedQuantity), material: unit, project: request.projectName })}
                  </Text>
                  {progress.started ? (
                    <>
                      <View style={styles.track} accessibilityRole="progressbar">
                        <View style={[styles.fill, { width: `${Math.round((progress.quantityShare ?? 0) * 100)}%` }]} />
                      </View>
                      <Text style={styles.progressText}>
                        {t("tb.progress_qty", { bought: formatQty(progress.bought), total: formatQty(progress.requested) })}
                        {progress.spent != null && progress.budget != null
                          ? ` · ${t("ck.given_spent", { budget: formatPeso(progress.budget), spent: formatPeso(progress.spent) })}`
                          : ""}
                      </Text>
                      <Pressable
                        onPress={() => setClosingId(closingId === request.ticketID ? null : request.ticketID)}
                        style={styles.closeLink}
                        accessibilityRole="button"
                      >
                        <Text style={styles.closeLinkText}>{t("ck.close_short")}</Text>
                      </Pressable>
                      {closingId === request.ticketID ? (
                        <View style={styles.closeBox}>
                          <Text style={styles.requestMeta}>
                            {t("ck.close_body", { bought: formatQty(progress.bought), total: formatQty(progress.requested) })}
                          </Text>
                          <View style={styles.closeChips}>
                            {[
                              ["ck.close_budget", "Budget ran out."],
                              ["ck.close_stock", "Store ran out of stock."],
                              ["ck.close_other", "Other reason."],
                            ].map(([key, english]) => (
                              <Pressable key={key} onPress={() => closeShort(request, english)} style={styles.closeChip} accessibilityRole="button">
                                <Text style={styles.closeChipText}>{t(key)}</Text>
                              </Pressable>
                            ))}
                          </View>
                        </View>
                      ) : null}
                    </>
                  ) : null}
                </View>
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

      {/* Always in reach, just above the tab bar. */}
      <View style={styles.pinned}>
        <View style={styles.pinnedRow}>
          <View style={styles.pinnedMain}><AppButton label={t("tb.snap")} onPress={snapFromFooter} /></View>
          <View style={styles.pinnedSide}><AppButton label={t("tb.gas_button")} variant="secondary" onPress={snapGas} /></View>
        </View>
      </View>

      <SnapProjectSheet
        visible={sheetOpen}
        projects={projectChoices.map((p) => ({ id: p.projectId, name: p.projectName }))}
        onPick={(project) => { setSheetOpen(false); snapReceipt(project); }}
        onMultiple={() => { setSheetOpen(false); snapReceipt(null); }}
        onClose={() => setSheetOpen(false)}
      />
    </SafeAreaView>
  );
}

// Labels stay soft; only the action buttons (AppButton) carry the strong brand color.
const SOFT = { band: "#FBF5EE", edge: "#E6C9AE", text: "#7A5236", fill: "#E9BD97" };

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, gap: 14, paddingBottom: 32 },

  header: { paddingTop: 0, paddingBottom: 2 },
  title: { fontSize: 26, fontFamily: FONT.extrabold, color: COLORS.heading },
  subtitle: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 2 },

  offlineNote: { color: COLORS.amberBannerText, backgroundColor: COLORS.amberBannerFill, padding: 10, borderRadius: 10, fontSize: 12, fontFamily: FONT.medium },

  controls: { gap: 10 },
  pinnedRow: { flexDirection: "row", gap: 10 },
  pinnedMain: { flex: 3 },
  pinnedSide: { flex: 2 },
  pinned: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.card },
  segment: { flexDirection: "row", backgroundColor: COLORS.border, borderRadius: 12, padding: 3 },
  segmentItem: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  segmentOn: { backgroundColor: COLORS.card },
  segmentText: { fontSize: 13, fontFamily: FONT.semibold, color: COLORS.muted },
  segmentTextOn: { color: COLORS.heading, fontFamily: FONT.bold },

  group: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 14, gap: 12 },
  // Each store / project is a tinted band with an accent edge, so it stands out from the requests under it.
  groupHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, backgroundColor: SOFT.band, borderLeftWidth: 5, borderLeftColor: SOFT.edge, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  groupTitle: { flex: 1, fontSize: 17, fontFamily: FONT.extrabold, color: SOFT.text },
  groupCountPill: { backgroundColor: COLORS.card, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: SOFT.edge },
  groupCount: { fontSize: 12, fontFamily: FONT.bold, color: SOFT.text },
  // "All stores" / "All projects": a soft tinted band, slightly deeper than the group headers.
  allBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: SOFT.fill, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 },
  allBannerTitle: { flex: 1, fontSize: 17, fontFamily: FONT.extrabold, color: SOFT.text },
  allBannerCount: { fontSize: 13, fontFamily: FONT.bold, color: SOFT.text },

  request: { gap: 4, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10, minHeight: MIN_TAP },
  requestTitle: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.heading },
  requestMeta: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted },
  track: { height: 6, borderRadius: 3, backgroundColor: COLORS.border, overflow: "hidden", marginTop: 4 },
  fill: { height: 6, borderRadius: 3, backgroundColor: SOFT.fill },
  progressText: { fontSize: 12, fontFamily: FONT.semibold, color: SOFT.text },
  closeLink: { minHeight: MIN_TAP, justifyContent: "center", alignSelf: "flex-start" },
  closeLinkText: { fontSize: 13, fontFamily: FONT.bold, color: COLORS.muted },
  closeBox: { gap: 8, backgroundColor: COLORS.bg, borderRadius: 12, padding: 10 },
  closeChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  closeChip: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 22, paddingHorizontal: 14, backgroundColor: COLORS.card },
  closeChipText: { fontSize: 13, fontFamily: FONT.semibold, color: COLORS.heading },
});
