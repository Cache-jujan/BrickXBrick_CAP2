import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useOnNewNotifications } from "@/lib/notification-events";

import { COLORS } from "@/constants/expense-flow-colors";
import { formatPeso, formatQty } from "@/lib/money";
import { type Project, type Ticket } from "@/lib/api";
import { useExpenseDraft } from "@/lib/expense-draft-context";
import { getSession } from "@/lib/auth";
import { plainError } from "@/lib/sync/messages";
import { loadActiveProjects, loadAssignedTickets } from "@/lib/cached-api";
import { SmBottomBar } from "@/components/sm-bottom-bar";

type FilterKey = "All" | "Pending" | "Rejected" | "Acknowledged" | "Resolved";
const FILTERS: FilterKey[] = ["All", "Pending", "Rejected", "Acknowledged", "Resolved"];

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  Pending: { bg: "#FFF0E6", fg: COLORS.primary },
  Acknowledged: { bg: "#EAF2FF", fg: "#2563EB" },
  Resolved: { bg: COLORS.successBg, fg: COLORS.success },
  Rejected: { bg: "#FFF5F3", fg: "#B42318" },
};

export default function MyRequestsScreen() {
  const session = getSession();
  const { setTicket, reset } = useExpenseDraft();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const focusId = typeof focus === "string" ? focus : null;

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [projectsById, setProjectsById] = useState<Record<string, Project>>({});
  const [filter, setFilter] = useState<FilterKey>("All");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const listRef = useRef<FlatList<Ticket>>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [ticketResult, projectResult] = await Promise.all([
        loadAssignedTickets("Site Manager"),
        loadActiveProjects(),
      ]);
      const ticketList = ticketResult.data;
      const projectList = projectResult.data;
      const byId: Record<string, Project> = {};
      for (const p of projectList) byId[p.projectid] = p;
      setProjectsById(byId);
      setTickets(ticketList);
    } catch (err) {
      setError(plainError(err, "Unable to load your requests."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // A pop-up just announced something new (e.g. the PM reviewed a task).
  useOnNewNotifications(() => { load(true); });

  useFocusEffect(
    useCallback(() => {
      if (session?.user.role === "Site Manager") load();
    }, [load, session?.user.role])
  );

  // Deep link from a notification: land on All and highlight the ticket
  // once it's in the list.
  useEffect(() => {
    if (!focusId || loading) return;
    if (!tickets.some((t) => t.ticketid === focusId)) return;
    setFilter("All");
    setHighlightId(focusId);
    const timer = setTimeout(() => setHighlightId(null), 2600);
    return () => clearTimeout(timer);
  }, [focusId, loading, tickets]);

  if (!session || session.user.role !== "Site Manager") return <Redirect href="/login" />;

  const sorted = [...tickets].sort(
    (a, b) => new Date(b.createdat).getTime() - new Date(a.createdat).getTime()
  );
  const visible = filter === "All" ? sorted : sorted.filter((t) => t.status === filter);
  const counts: Record<FilterKey, number> = {
    All: sorted.length,
    Pending: sorted.filter((t) => t.status === "Pending").length,
    Rejected: sorted.filter((t) => t.status === "Rejected").length,
    Acknowledged: sorted.filter((t) => t.status === "Acknowledged").length,
    Resolved: sorted.filter((t) => t.status === "Resolved").length,
  };

  // Once the highlighted ticket is in view (filter switched to All above),
  // scroll the list to it.
  useEffect(() => {
    if (!highlightId) return;
    const index = visible.findIndex((t) => t.ticketid === highlightId);
    if (index < 0) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.2 });
    }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId, tickets]);

  function openExpenseCapture(t: Ticket) {
    reset();
    const project = projectsById[t.projectid];
    setTicket({
      ticketId: t.ticketid,
      projectId: t.projectid,
      projectName: project?.name ?? "Unknown project",
      subject: t.subject,
      budget: t.approvedbudget == null ? undefined : String(t.approvedbudget),
    });
    router.push("/expense/capture");
  }

  function onScrollFail(info: { index: number }) {
    // Item not measured yet (still rendering) — retry shortly.
    setTimeout(() => {
      listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.2 });
    }, 150);
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.eyebrow}>SITE MANAGER</Text>
        <Text style={styles.title}>My requests</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chipsRow}>
        {FILTERS.map((key) => (
          <Pressable
            key={key}
            onPress={() => setFilter(key)}
            style={[styles.chip, filter === key && styles.chipActive]}
          >
            <Text style={[styles.chipText, filter === key && styles.chipTextActive]}>
              {key} ({counts[key]})
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Couldn't load your requests</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <Pressable onPress={() => load()} style={styles.retryButton}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={visible}
          keyExtractor={(t) => t.ticketid}
          contentContainerStyle={styles.list}
          onScrollToIndexFailed={onScrollFail}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
          ListEmptyComponent={
            loading ? (
              <View style={styles.emptyCard}>
                <ActivityIndicator color={COLORS.primary} />
                <Text style={styles.emptyBody}>Loading your requests…</Text>
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>
                  {filter === "All" ? "No requests yet" : `No ${filter.toLowerCase()} requests`}
                </Text>
                <Text style={styles.emptyBody}>
                  {filter === "All"
                    ? "Tickets you submit will show up here as your Project Manager works through them."
                    : filter === "Rejected"
                      ? "Nothing's been rejected — nice."
                      : "Nothing in this view right now."}
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <RequestCard
              ticket={item}
              project={projectsById[item.projectid]}
              highlighted={item.ticketid === highlightId}
              onExpenseCapture={() => openExpenseCapture(item)}
            />
          )}
        />
      )}
      <SmBottomBar />
    </SafeAreaView>
  );
}

function RequestCard({
  ticket,
  project,
  highlighted,
  onExpenseCapture,
}: {
  ticket: Ticket;
  project: Project | undefined;
  highlighted: boolean;
  onExpenseCapture: () => void;
}) {
  const statusColors = STATUS_COLORS[ticket.status] ?? { bg: "#F1E9DD", fg: COLORS.muted };
  const isRejected = ticket.status === "Rejected";
  const isResolvedMR = ticket.status === "Resolved" && ticket.tickettype === "Material Request";
  const wasResubmitted = ticket.resubmittedbyid != null;
  const expenseCount = Number(ticket.expensecount || 0);
  const alreadyCaptured = expenseCount > 0;

  const metaBits: string[] = [];
  if (ticket.quantity != null && ticket.unit) {
    metaBits.push(`${formatQty(Number(ticket.quantity))} ${ticket.unit}`);
  } else if (ticket.materialtype) {
    metaBits.push(ticket.materialtype);
  }
  if (ticket.approvedbudget != null) metaBits.push(`Approved ${formatPeso(ticket.approvedbudget)}`);
  else if (ticket.requestedbudget != null) metaBits.push(`Requested ${formatPeso(ticket.requestedbudget)}`);

  const body = (
    <View style={[styles.card, highlighted && styles.cardHighlighted]}>
      <View style={styles.cardTopRow}>
        <Text style={styles.cardType}>{ticket.tickettype}</Text>
        <View style={[styles.statusPill, { backgroundColor: statusColors.bg }]}>
          <Text style={[styles.statusPillText, { color: statusColors.fg }]}>{ticket.status}</Text>
        </View>
      </View>

      <Text style={styles.cardSubject} numberOfLines={2}>{ticket.subject}</Text>

      <Text style={styles.cardMeta} numberOfLines={1}>
        {(project?.name ?? "Project")} · {new Date(ticket.createdat).toLocaleDateString()}
      </Text>

      {metaBits.length > 0 && (
        <Text style={styles.cardSubMeta} numberOfLines={1}>{metaBits.join(" · ")}</Text>
      )}

      {isRejected && (
        <View style={styles.rejectionBlock}>
          <Text style={styles.rejectionLabel}>
            Rejected{ticket.rejectedbyrole ? ` by ${ticket.rejectedbyrole}` : ""}
          </Text>
          <Text style={styles.rejectionReason}>
            {ticket.rejectionreason?.trim() || "No reason given."}
          </Text>
          {wasResubmitted ? (
            <View style={styles.resubmittedPill}>
              <Text style={styles.resubmittedPillText}>Resubmitted ✓</Text>
            </View>
          ) : (
            <Pressable
              onPress={() => router.push(`/ticket-request?resubmitFrom=${ticket.ticketid}`)}
              style={styles.fixButton}
            >
              <Text style={styles.fixButtonText}>Fix & resubmit</Text>
            </Pressable>
          )}
        </View>
      )}

      {isResolvedMR && (
        <View style={styles.captureBlock}>
          {alreadyCaptured && (
            <Text style={styles.capturedNote}>
              {expenseCount} expense{expenseCount === 1 ? "" : "s"} captured · {formatPeso(ticket.expensetotal)}
            </Text>
          )}
          <View style={[styles.captureButton, alreadyCaptured && styles.captureButtonSecondary]}>
            <Text style={[styles.captureButtonText, alreadyCaptured && styles.captureButtonTextSecondary]}>
              {alreadyCaptured ? "+ Add another expense" : "+ Add Expense"}
            </Text>
          </View>
        </View>
      )}
    </View>
  );

  return isResolvedMR ? <Pressable onPress={onExpenseCapture}>{body}</Pressable> : body;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F8F1E8" },
  topBar: { paddingHorizontal: 20, paddingTop: 14 },
  backButton: { alignSelf: "flex-start", marginBottom: 14 },
  backText: { color: COLORS.primary, fontSize: 14, fontWeight: "700" },
  eyebrow: { color: COLORS.primary, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  title: { color: COLORS.heading, fontSize: 25, fontWeight: "800", marginTop: 6, marginBottom: 12 },

  // flexGrow 0: a horizontal ScrollView otherwise stretches to fill the
  // screen's height, which made the filter chips huge.
  chipsScroll: { flexGrow: 0 },
  chipsRow: { paddingHorizontal: 20, gap: 8, paddingBottom: 14, alignItems: "center" },
  chip: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 13,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E7DDCF",
    backgroundColor: COLORS.card,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 12, fontWeight: "700", color: COLORS.muted },
  chipTextActive: { color: "#FFFFFF" },

  list: { paddingHorizontal: 20, paddingBottom: 36, gap: 10 },

  card: {
    backgroundColor: COLORS.card,
    borderColor: "#E7DDCF",
    borderWidth: 1,
    borderRadius: 16,
    padding: 15,
  },
  cardHighlighted: { borderColor: COLORS.primary, borderWidth: 2 },
  cardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardType: { color: COLORS.primary, fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },
  statusPill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  statusPillText: { fontSize: 11, fontWeight: "800" },
  cardSubject: { color: COLORS.heading, fontSize: 15, fontWeight: "700", marginTop: 9, lineHeight: 21 },
  cardMeta: { color: COLORS.muted, fontSize: 12, fontWeight: "600", marginTop: 6 },
  cardSubMeta: { color: COLORS.muted, fontSize: 12, marginTop: 3 },

  rejectionBlock: {
    backgroundColor: "#FFF5F3",
    borderColor: "#F4C7C3",
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 12,
    padding: 11,
  },
  rejectionLabel: { color: "#B42318", fontSize: 10, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  rejectionReason: { color: COLORS.heading, fontSize: 13, fontWeight: "600", marginTop: 4, lineHeight: 18 },
  fixButton: {
    alignSelf: "flex-start",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    backgroundColor: "#B42318",
    borderRadius: 10,
    marginTop: 10,
    paddingHorizontal: 13,
  },
  fixButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  resubmittedPill: {
    alignSelf: "flex-start",
    backgroundColor: COLORS.successBg,
    borderRadius: 10,
    marginTop: 10,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  resubmittedPillText: { color: COLORS.success, fontSize: 12, fontWeight: "800" },

  captureBlock: { marginTop: 12 },
  capturedNote: { color: COLORS.success, fontSize: 12, fontWeight: "700", marginBottom: 8 },
  captureButton: {
    alignSelf: "flex-start",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    borderColor: COLORS.primary,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  captureButtonSecondary: { borderColor: "#E7DDCF", backgroundColor: "#F1E9DD" },
  captureButtonText: { color: COLORS.primary, fontSize: 12, fontWeight: "700" },
  captureButtonTextSecondary: { color: COLORS.muted },

  emptyCard: {
    alignItems: "center",
    backgroundColor: COLORS.card,
    borderColor: "#E7DDCF",
    borderWidth: 1,
    borderRadius: 16,
    gap: 10,
    marginTop: 18,
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  emptyTitle: { color: COLORS.heading, fontSize: 15, fontWeight: "800" },
  emptyBody: { color: COLORS.muted, fontSize: 13, lineHeight: 19, textAlign: "center" },

  errorCard: {
    backgroundColor: "#FFF5F3",
    borderColor: "#F4C7C3",
    borderWidth: 1,
    borderRadius: 16,
    marginHorizontal: 20,
    marginTop: 8,
    padding: 16,
  },
  errorTitle: { color: "#B42318", fontSize: 15, fontWeight: "800" },
  errorBody: { color: "#8C2D24", fontSize: 13, lineHeight: 19, marginTop: 6 },
  retryButton: { alignSelf: "flex-start", backgroundColor: COLORS.primary, borderRadius: 10, marginTop: 12, paddingHorizontal: 13, paddingVertical: 9 },
  retryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
});