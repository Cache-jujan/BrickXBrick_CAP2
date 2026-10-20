import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router, useFocusEffect } from "expo-router";

import { COLORS } from "@/constants/expense-flow-colors";
import { type AssignedTask } from "@/lib/api";
import { loadAssignedTasks } from "@/lib/cached-api";
import { getSession } from "@/lib/auth";
import { useOnNewNotifications } from "@/lib/notification-events";
import { dueLabel, projectSummaries, splitTasks, toDay } from "@/lib/sm-dashboard";
import { getPendingTaskUpdateForTask } from "@/lib/sync/db";
import { describeLoadError } from "@/lib/sync/messages";
import { useNetwork } from "@/lib/sync/network-context";
import { savedAtLabel } from "@/lib/sync/offline-cache";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { NotificationBell } from "@/components/notification-bell";
import { SmBottomBar } from "@/components/sm-bottom-bar";

type FilterKey = "All" | "Pending" | "Today" | "Upcoming" | "Past due" | "Completed";
const FILTERS: FilterKey[] = ["All", "Pending", "Today", "Upcoming", "Past due", "Completed"];

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dueDay(task: AssignedTask): number | null {
  const due = new Date(task.duedate);
  return Number.isNaN(due.getTime()) ? null : startOfDay(due);
}

// Today / Upcoming / Past due only look at tasks that are not completed yet.
function matchesFilter(task: AssignedTask, key: FilterKey, today: number) {
  const done = task.status === "Completed";
  if (key === "All") return true;
  if (key === "Completed") return done;
  if (done) return false;
  if (key === "Pending") return true;
  const due = dueDay(task);
  if (due === null) return false;
  if (key === "Today") return due === today;
  if (key === "Upcoming") return due > today;
  return due < today; // Past due
}

export default function SiteManagerHomeScreen() {
  const session = getSession();
  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("All");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Set when the list on screen is the copy saved on this phone (offline).
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const loadTasks = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const result = await loadAssignedTasks();
      setTasks(result.data);
      setSavedAt(result.fromCache ? result.savedAt : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load assigned tasks.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // A pop-up just announced something new (e.g. the PM reviewed a task).
  useOnNewNotifications(() => { loadTasks(true); });

  useFocusEffect(
    useCallback(() => {
      if (session?.user.role === "Site Manager") loadTasks();
    }, [loadTasks, session?.user.role])
  );

  // Offline: keep the list that was loaded last and never show a server error
  // (the banner already says "offline"). Reload by itself on reconnect.
  const { isOnline } = useNetwork(); // any queue change re-renders the list, so the labels stay current
  const wasOnline = useRef(isOnline);
  useEffect(() => {
    if (isOnline && !wasOnline.current && session?.user.role === "Site Manager") loadTasks(true);
    wasOnline.current = isOnline;
  }, [isOnline, loadTasks, session?.user.role]);
  const shownError = describeLoadError(error, isOnline);

  const today = startOfDay(new Date());

  // Completed tasks move to "Archived" 7 days after completion
  // (lib/sm-dashboard.js); the filters and folders show the rest.
  const { open: openTasks, archived } = useMemo(() => splitTasks(tasks), [tasks]);
  const visibleTasks = useMemo(() => {
    const archivedIds = new Set(archived.map((task) => task.taskid));
    return tasks.filter((task) => !archivedIds.has(task.taskid));
  }, [tasks, archived]);
  const nextUp = openTasks.slice(0, 3);
  const dueToday = openTasks.filter((task) => dueLabel(task.duedate).tone === "today").length;
  const overdue = openTasks.filter((task) => dueLabel(task.duedate).tone === "late").length;
  // Project dates and the nearest open deadline, shown on each folder.
  const projectInfo = useMemo(() => {
    const byName = new Map<string, ReturnType<typeof projectSummaries>[number]>();
    projectSummaries(tasks).forEach((p) => byName.set(p.name, p));
    return byName;
  }, [tasks]);

  const counts = useMemo(() => {
    const result = {} as Record<FilterKey, number>;
    FILTERS.forEach((key) => {
      result[key] = visibleTasks.filter((task) => matchesFilter(task, key, today)).length;
    });
    return result;
  }, [visibleTasks, today]);

  // One folder per project. The pending badge counts every unfinished task in
  // the project; the cards inside only show what the active filter allows.
  const folders = useMemo(() => {
    const byProject = new Map<string, { name: string; all: AssignedTask[]; shown: AssignedTask[] }>();
    visibleTasks.forEach((task) => {
      const name = task.projectname || "Other tasks";
      if (!byProject.has(name)) byProject.set(name, { name, all: [], shown: [] });
      const folder = byProject.get(name)!;
      folder.all.push(task);
      if (matchesFilter(task, filter, today)) folder.shown.push(task);
    });
    return Array.from(byProject.values()).filter((folder) => folder.shown.length > 0);
  }, [visibleTasks, filter, today]);

  if (!session || session.user.role !== "Site Manager") return <Redirect href="/login" />;

  const firstName = session.user.name.split(" ")[0] || "there";

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadTasks(true)} />
        }
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.eyebrow}>SITE MANAGER</Text>
            <Text style={styles.title}>Good morning, {firstName}.</Text>
          </View>
          <View style={styles.headerActions}>
            <NotificationBell color={COLORS.heading} />
            <Pressable
              onPress={() => router.push("/settings")}
              style={styles.settingsButton}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Open settings"
            >
              <IconSymbol name="gearshape.fill" size={22} color={COLORS.heading} />
            </Pressable>
          </View>
        </View>

        <View style={styles.actionGrid}>
          <Pressable
            style={styles.actionCard}
            onPress={() => router.push("/ticket-request")}
            accessibilityRole="button"
            accessibilityLabel="Request ticket"
          >
            <Text style={styles.actionIcon}>＋</Text>
            <Text style={styles.actionLabel}>Ticket</Text>
          </Pressable>
          <Pressable
            style={styles.actionCard}
            onPress={() => router.push("/(tabs)")}
            accessibilityRole="button"
            accessibilityLabel="Submit receipt"
          >
            <Text style={styles.actionIcon}>▣</Text>
            <Text style={styles.actionLabel}>Receipt</Text>
          </Pressable>
          <Pressable
            style={styles.actionCard}
            onPress={() => router.push("/site-manager/my-requests")}
            accessibilityRole="button"
            accessibilityLabel="My requests"
          >
            <Text style={styles.actionIcon}>▤</Text>
            <Text style={styles.actionLabel}>My Requests</Text>
          </Pressable>
        </View>

        <View style={styles.summaryCard}>
          <View style={styles.summaryHead}>
            <View style={styles.flex}>
              <Text style={styles.summaryLabel}>MY TASKS</Text>
              <Text style={styles.summaryTitle}>
                {loading
                  ? "Checking your tasks…"
                  : openTasks.length === 0
                    ? "All caught up"
                    : `${openTasks.length} open task${openTasks.length === 1 ? "" : "s"}`}
              </Text>
              {!loading && (dueToday > 0 || overdue > 0) && (
                <Text style={styles.summaryAlert}>
                  {[overdue > 0 && `${overdue} overdue`, dueToday > 0 && `${dueToday} due today`].filter(Boolean).join(" · ")}
                </Text>
              )}
            </View>
            <View style={styles.summaryIcon}>
              <IconSymbol name="list.clipboard.fill" size={26} color="#FFFFFF" />
            </View>
          </View>
          {nextUp.map((task) => {
            const due = dueLabel(task.duedate);
            return (
              <Pressable
                key={task.taskid}
                onPress={() => router.push(`/site-manager/task/${task.taskid}`)}
                style={({ pressed }) => [styles.summaryRow, pressed && styles.taskCardPressed]}
                accessibilityRole="button"
                accessibilityLabel={`${task.taskname}, ${due.text}`}
              >
                <Text style={styles.summaryRowName} numberOfLines={1}>{task.taskname}</Text>
                <Text style={[styles.summaryRowDue, DUE_TONE[due.tone]]}>{due.text}</Text>
              </Pressable>
            );
          })}
          {openTasks.length > nextUp.length && (
            <Text style={styles.summaryMore}>+{openTasks.length - nextUp.length} more below</Text>
          )}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Assigned tasks</Text>
          <Text style={styles.sectionMeta}>{openTasks.length} open</Text>
        </View>

        {(!isOnline || savedAt) && (
          <Text style={styles.offlineNote}>
            {savedAt
              ? `${isOnline ? "Can't reach the server" : "You're offline"} · showing your tasks ${savedAtLabel(savedAt)}. You can open a task and queue an update; it is sent when you're back online.`
              : tasks.length > 0
                ? "You're offline. Showing your tasks as last loaded. You can still open a task and queue an update."
                : "You're offline, and your tasks haven't been saved on this phone yet. Open the app once with a connection; after that it works offline."}
          </Text>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={styles.chipsScroll}
        >
          {FILTERS.map((key) => (
            <Pressable
              key={key}
              onPress={() => setFilter(key)}
              style={[styles.chip, filter === key && styles.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === key }}
            >
              <Text style={[styles.chipText, filter === key && styles.chipTextActive]}>
                {key} ({counts[key]})
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {shownError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Couldn’t load tasks</Text>
            <Text style={styles.errorBody}>{shownError}</Text>
            <Pressable onPress={() => loadTasks()} style={styles.retryButton}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : loading ? (
          <View style={styles.emptyCard}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={styles.emptyBody}>Loading assigned tasks…</Text>
          </View>
        ) : tasks.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Text style={styles.emptyIconText}>✓</Text>
            </View>
            <Text style={styles.emptyTitle}>No tasks to show yet</Text>
            <Text style={styles.emptyBody}>
              Tasks assigned to you by your Project Manager will appear here.
            </Text>
          </View>
        ) : folders.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Nothing in “{filter}”</Text>
            <Text style={styles.emptyBody}>No tasks match this filter right now.</Text>
          </View>
        ) : (
          <View style={styles.folderList}>
            {folders.map((folder) => {
              const pending = folder.all.filter((task) => task.status !== "Completed").length;
              const isCollapsed = !!collapsed[folder.name];
              const info = projectInfo.get(folder.name);
              const next = info?.next ? dueLabel(info.next.date) : null;
              return (
                <View key={folder.name} style={styles.folder}>
                  <Pressable
                    onPress={() => setCollapsed((prev) => ({ ...prev, [folder.name]: !prev[folder.name] }))}
                    style={styles.folderHeader}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !isCollapsed }}
                    accessibilityLabel={`${folder.name}, ${pending} pending`}
                  >
                    <Text style={styles.folderChevron}>{isCollapsed ? "▸" : "▾"}</Text>
                    <View style={styles.folderTitleWrap}>
                      <Text style={styles.folderName} numberOfLines={1}>{folder.name}</Text>
                      <Text style={styles.folderMeta}>{folder.all.length} task{folder.all.length === 1 ? "" : "s"} in total</Text>
                      {info?.startDate && (
                        <Text style={styles.folderMeta}>
                          {formatDay(info.startDate)} – {info.endDate ? formatDay(info.endDate) : "no end date"}
                        </Text>
                      )}
                      {info?.next && next && (
                        <Text style={[styles.folderNext, DUE_TONE[next.tone]]} numberOfLines={2}>
                          Nearest deadline: {info.next.label} · {next.text}
                        </Text>
                      )}
                    </View>
                    <View style={[styles.pendingBadge, pending === 0 && styles.pendingBadgeDone]}>
                      <Text style={[styles.pendingBadgeText, pending === 0 && styles.pendingBadgeTextDone]}>
                        {pending === 0 ? "All done" : `${pending} pending`}
                      </Text>
                    </View>
                  </Pressable>
                  {!isCollapsed && (
                    <View style={styles.folderBody}>
                      {folder.shown.map((task) => <TaskCard key={task.taskid} task={task} today={today} />)}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {!loading && archived.length > 0 && (filter === "All" || filter === "Completed") && (
          <View style={styles.archiveWrap}>
            <Pressable onPress={() => setShowArchived((v) => !v)} style={styles.archiveToggle} accessibilityRole="button">
              <Text style={styles.archiveToggleText}>
                {showArchived ? "Hide archived" : `Show archived (${archived.length})`}
              </Text>
              <Text style={styles.archiveHint}>Completed more than 7 days ago</Text>
            </Pressable>
            {showArchived && archived.map((task) => <TaskCard key={task.taskid} task={task} today={today} />)}
          </View>
        )}
      </ScrollView>
      <SmBottomBar />
    </SafeAreaView>
  );
}

function TaskCard({ task, today }: { task: AssignedTask; today: number }) {
  const completed = task.status === "Completed";
  // D-04: the SM previously had no way to see that a submission was
  // flagged — a flag only lived in the log row, never surfaced here.
  const flagged = task.latestreviewstatus === "Flagged";
  // A submission is waiting for the PM: the task status itself does not
  // change until the PM acknowledges, so show it here.
  const awaitingReview = !completed && !!task.pendingphotoevidenceurl;
  // F10: an update saved on this phone and not sent yet.
  const queuedOnPhone = !completed && !!getPendingTaskUpdateForTask(task.taskid);
  const due = dueDay(task);
  const pastDue = !completed && due !== null && due < today;
  const label = dueLabel(task.duedate);

  return (
    <Pressable
      onPress={() => router.push(`/site-manager/task/${task.taskid}`)}
      style={({ pressed }) => [styles.taskCard, pressed && styles.taskCardPressed]}
    >
      <View style={styles.taskTopRow}>
        <View style={styles.taskStatusRow}>
          {completed && <IconSymbol name="checkmark.circle.fill" size={14} color={COLORS.success} />}
          <Text style={[styles.taskStatus, completed && styles.taskStatusDone]}>
            {completed ? "COMPLETED" : pastDue ? "PAST DUE" : "ASSIGNED"}
          </Text>
        </View>
        <Text style={[styles.taskDue, !completed && DUE_TONE[label.tone]]}>
          {completed ? `Due ${formatDay(task.duedate)}` : label.text}
        </Text>
      </View>
      <Text style={styles.taskName}>{task.taskname}</Text>
      {task.milestonename && <Text style={styles.taskProject}>{task.milestonename}</Text>}
      {flagged && (
        <View style={styles.flagPill}>
          <Text style={styles.flagPillText}>Flagged — resubmission needed</Text>
        </View>
      )}
      <View style={styles.taskBottomRow}>
        <Text style={styles.taskProgress}>{Number(task.completionpercentage || 0)}% complete</Text>
        <View style={[styles.statusPill, completed && styles.statusPillCompleted]}>
          <Text style={[styles.statusPillText, completed && styles.statusPillTextCompleted]}>
            {queuedOnPhone ? "Queued on phone" : awaitingReview ? "Awaiting PM review" : task.status}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function formatDay(value?: string | null) {
  const day = toDay(value);
  return day ? day.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
}

const DUE_TONE = StyleSheet.create({
  late: { color: "#D92D20", fontWeight: "800" },
  today: { color: "#E85D0C", fontWeight: "800" },
  soon: { color: "#B45309", fontWeight: "700" },
  normal: {},
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  summaryCard: { backgroundColor: "#1A1A1A", borderRadius: 18, marginTop: 20, overflow: "hidden", padding: 20 },
  summaryHead: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 6 },
  summaryLabel: { color: "#D8C7AA", fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  summaryTitle: { color: "#FFFFFF", fontSize: 21, fontWeight: "800", lineHeight: 27, marginTop: 10 },
  summaryAlert: { color: "#FFB27A", fontSize: 13, fontWeight: "700", marginTop: 6 },
  summaryIcon: { alignItems: "center", backgroundColor: COLORS.primary, borderRadius: 28, height: 56, justifyContent: "center", width: 56 },
  summaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, borderTopColor: "#333", borderTopWidth: 1, paddingVertical: 11 },
  summaryRowName: { color: "#FFFFFF", flex: 1, fontSize: 14, fontWeight: "700" },
  summaryRowDue: { color: "#C9C0B3", fontSize: 12 },
  summaryMore: { color: "#C9C0B3", fontSize: 12, marginTop: 4 },
  folderNext: { color: COLORS.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  taskStatusRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  taskStatusDone: { color: COLORS.success },
  archiveWrap: { gap: 10, marginTop: 14 },
  archiveToggle: { alignItems: "center", borderColor: "#E7DDCF", borderRadius: 12, borderStyle: "dashed", borderWidth: 1, paddingVertical: 12 },
  archiveToggleText: { color: COLORS.primary, fontSize: 13, fontWeight: "800" },
  archiveHint: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  offlineNote: { backgroundColor: "#FFF4E5", borderColor: "#F5D6A8", borderRadius: 12, borderWidth: 1, color: "#7A4B00", fontSize: 13, lineHeight: 18, marginBottom: 12, padding: 12 },
  safeArea: { backgroundColor: "#F8F1E8", flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 28 },
  headerRow: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  eyebrow: { color: COLORS.primary, fontSize: 11, fontWeight: "800", letterSpacing: 1.5, marginBottom: 7 },
  title: { color: "#1A1A1A", fontSize: 25, fontWeight: "800", letterSpacing: -0.4, maxWidth: 250 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  settingsButton: { borderColor: "#D8CDBD", borderRadius: 10, borderWidth: 1, padding: 7 },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10, marginTop: 26 },
  sectionTitle: { color: COLORS.heading, fontSize: 17, fontWeight: "800" },
  sectionMeta: { color: COLORS.muted, fontSize: 12, fontWeight: "600" },
  chipsScroll: { flexGrow: 0, marginBottom: 14 },
  chipsRow: { gap: 8, paddingRight: 8 },
  chip: { backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 20, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 8 },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.heading, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: "#FFFFFF" },
  folderList: { gap: 14 },
  folder: { backgroundColor: "#FFFCF8", borderColor: "#E7DDCF", borderRadius: 18, borderWidth: 1, overflow: "hidden" },
  folderHeader: { alignItems: "center", flexDirection: "row", gap: 10, padding: 14 },
  folderChevron: { color: COLORS.primary, fontSize: 16, fontWeight: "800", width: 14 },
  folderTitleWrap: { flex: 1 },
  folderName: { color: COLORS.heading, fontSize: 15, fontWeight: "800" },
  folderMeta: { color: COLORS.muted, fontSize: 11, fontWeight: "600", marginTop: 2 },
  pendingBadge: { backgroundColor: "#FFF0E6", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  pendingBadgeDone: { backgroundColor: COLORS.successBg },
  pendingBadgeText: { color: COLORS.primary, fontSize: 11, fontWeight: "800" },
  pendingBadgeTextDone: { color: COLORS.success },
  folderBody: { gap: 10, paddingBottom: 12, paddingHorizontal: 12 },
  taskCard: { backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 16, borderWidth: 1, padding: 16 },
  taskCardPressed: { opacity: 0.78 },
  taskTopRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  taskStatus: { color: COLORS.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.1 },
  taskDue: { color: COLORS.muted, fontSize: 12 },
  taskDuePast: { color: "#B42318", fontWeight: "700" },
  taskName: { color: COLORS.heading, fontSize: 16, fontWeight: "800", lineHeight: 22, marginTop: 10 },
  taskProject: { color: COLORS.muted, fontSize: 12, fontWeight: "600", marginTop: 4 },
  flagPill: { alignSelf: "flex-start", backgroundColor: "#FFF5F3", borderColor: "#F4C7C3", borderRadius: 10, borderWidth: 1, marginTop: 10, paddingHorizontal: 10, paddingVertical: 5 },
  flagPillText: { color: "#B42318", fontSize: 11, fontWeight: "800" },
  taskBottomRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 14 },
  taskProgress: { color: COLORS.muted, fontSize: 12, fontWeight: "600" },
  statusPill: { backgroundColor: "#FFF0E6", borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5 },
  statusPillCompleted: { backgroundColor: COLORS.successBg },
  statusPillText: { color: COLORS.primary, fontSize: 11, fontWeight: "700" },
  statusPillTextCompleted: { color: COLORS.success },
  emptyCard: { alignItems: "center", backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 16, borderWidth: 1, paddingHorizontal: 24, paddingVertical: 28 },
  emptyIcon: { alignItems: "center", backgroundColor: COLORS.successBg, borderRadius: 24, height: 48, justifyContent: "center", width: 48 },
  emptyIconText: { color: COLORS.success, fontSize: 23, fontWeight: "800" },
  emptyTitle: { color: COLORS.heading, fontSize: 16, fontWeight: "800", marginTop: 14 },
  emptyBody: { color: COLORS.muted, fontSize: 13, lineHeight: 19, marginTop: 7, textAlign: "center" },
  errorCard: { backgroundColor: "#FFF5F3", borderColor: "#F4C7C3", borderRadius: 16, borderWidth: 1, padding: 16 },
  errorTitle: { color: "#B42318", fontSize: 15, fontWeight: "800" },
  errorBody: { color: "#8C2D24", fontSize: 13, lineHeight: 19, marginTop: 6 },
  retryButton: { alignSelf: "flex-start", backgroundColor: COLORS.primary, borderRadius: 10, marginTop: 12, paddingHorizontal: 13, paddingVertical: 9 },
  retryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  actionGrid: { flexDirection: "row", gap: 10, marginTop: 18 },
  actionCard: { alignItems: "center", backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 14, borderWidth: 1, flex: 1, minHeight: 78, justifyContent: "center" },
  actionIcon: { color: COLORS.primary, fontSize: 24, fontWeight: "700" },
  actionLabel: { color: COLORS.heading, fontSize: 13, fontWeight: "700", marginTop: 8 },
});