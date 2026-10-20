import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Redirect, router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useOnNewNotifications } from "@/lib/notification-events";
import { dueLabel, projectSummaries, splitTasks, toDay } from "@/lib/sm-dashboard";
import { COLORS } from "@/constants/expense-flow-colors";
import { type AssignedTask } from "@/lib/api";
import { loadAssignedTasks } from "@/lib/cached-api";
import { savedAtLabel } from "@/lib/sync/offline-cache";
import { getSession } from "@/lib/auth";
import { describeLoadError } from "@/lib/sync/messages";
import { getPendingTaskUpdateForTask } from "@/lib/sync/db";
import { useNetwork } from "@/lib/sync/network-context";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { NotificationBell } from "@/components/notification-bell";

export default function SiteManagerHomeScreen() {
  const session = getSession();
  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  if (!session || session.user.role !== "Site Manager") return <Redirect href="/login" />;

  const firstName = session.user.name.split(" ")[0] || "there";
  // Open work nearest-deadline first; completed tasks move to "Archived"
  // 7 days after completion (lib/sm-dashboard.js).
  const { open: openTasks, recent: recentCompleted, archived } = splitTasks(tasks);
  const nextUp = openTasks.slice(0, 3);
  const dueToday = openTasks.filter((t) => dueLabel(t.duedate).tone === "today").length;
  const overdue = openTasks.filter((t) => dueLabel(t.duedate).tone === "late").length;
  const projects = projectSummaries(tasks);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
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

        {projects.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>My projects</Text>
              <Text style={styles.sectionMeta}>{projects.length}</Text>
            </View>
            <View style={styles.taskList}>
              {projects.map((p) => {
                const next = p.next ? dueLabel(p.next.date) : null;
                return (
                  <View key={p.projectId} style={styles.projectCard}>
                    <View style={styles.projectTop}>
                      <IconSymbol name="folder.fill" size={16} color={COLORS.primary} />
                      <Text style={styles.projectName} numberOfLines={2}>{p.name}</Text>
                    </View>
                    <View style={styles.projectDates}>
                      <IconSymbol name="calendar" size={13} color={COLORS.muted} />
                      <Text style={styles.projectDateText}>
                        {formatDay(p.startDate)} – {p.endDate ? formatDay(p.endDate) : "no end date"}
                      </Text>
                    </View>
                    <Text style={styles.projectMeta}>
                      {p.openCount === 0 ? "No open tasks" : `${p.openCount} open task${p.openCount === 1 ? "" : "s"}`}
                    </Text>
                    {p.next && next && (
                      <Text style={[styles.projectNext, DUE_TONE[next.tone]]} numberOfLines={2}>
                        Nearest deadline: {p.next.label} · {next.text}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </>
        )}

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
        ) : (
          <View style={styles.taskList}>
            {openTasks.map((task) => <TaskCard key={task.taskid} task={task} />)}
            {recentCompleted.length > 0 && (
              <Text style={styles.completedHeading}>Completed this week</Text>
            )}
            {recentCompleted.map((task) => <TaskCard key={task.taskid} task={task} />)}
            {archived.length > 0 && (
              <Pressable onPress={() => setShowArchived((v) => !v)} style={styles.archiveToggle} accessibilityRole="button">
                <Text style={styles.archiveToggleText}>
                  {showArchived ? "Hide archived" : `Show archived (${archived.length})`}
                </Text>
                <Text style={styles.archiveHint}>Completed more than 7 days ago</Text>
              </Pressable>
            )}
            {showArchived && archived.map((task) => <TaskCard key={task.taskid} task={task} />)}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

function TaskCard({ task }: { task: AssignedTask }) {
  const completed = task.status === "Completed";
  // D-04: the SM previously had no way to see that a submission was
  // flagged — a flag only lived in the log row, never surfaced here.
  const flagged = task.latestreviewstatus === "Flagged";
  // A submission is waiting for the PM: the task status itself does not
  // change until the PM acknowledges, so show it here.
  const awaitingReview = !completed && !!task.pendingphotoevidenceurl;
  // F10: an update saved on this phone and not sent yet.
  const queuedOnPhone = !completed && !!getPendingTaskUpdateForTask(task.taskid);
  const due = dueLabel(task.duedate);

  return (
    <Pressable
      onPress={() => router.push(`/site-manager/task/${task.taskid}`)}
      style={({ pressed }) => [styles.taskCard, pressed && styles.taskCardPressed]}
    >
      <View style={styles.taskTopRow}>
        <View style={styles.taskStatusRow}>
          {completed && <IconSymbol name="checkmark.circle.fill" size={14} color={COLORS.success} />}
          <Text style={[styles.taskStatus, completed && styles.taskStatusDone]}>{completed ? "COMPLETED" : "ASSIGNED"}</Text>
        </View>
        <Text style={[styles.taskDue, !completed && DUE_TONE[due.tone]]}>
          {completed ? `Due ${formatDay(task.duedate)}` : due.text}
        </Text>
      </View>
      <Text style={styles.taskName}>{task.taskname}</Text>
      {task.projectname && (
        <Text style={styles.taskProject}>{task.projectname} &middot; {task.milestonename}</Text>
      )}
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
  safeArea: { backgroundColor: "#F8F1E8", flex: 1 },
  content: { padding: 20, paddingBottom: 36 },
  headerRow: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  eyebrow: { color: COLORS.primary, fontSize: 11, fontWeight: "800", letterSpacing: 1.5, marginBottom: 7 },
  title: { color: "#1A1A1A", fontSize: 25, fontWeight: "800", letterSpacing: -0.4, maxWidth: 250 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  settingsButton: { borderColor: "#D8CDBD", borderRadius: 10, borderWidth: 1, padding: 7 },
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
  projectCard: { backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 16, borderWidth: 1, padding: 14, gap: 6 },
  projectTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  projectName: { color: COLORS.heading, flex: 1, fontSize: 15, fontWeight: "800" },
  projectDates: { flexDirection: "row", alignItems: "center", gap: 6 },
  projectDateText: { color: COLORS.muted, fontSize: 12, fontWeight: "600" },
  projectMeta: { color: COLORS.heading, fontSize: 12, fontWeight: "600" },
  projectNext: { color: COLORS.muted, fontSize: 12, lineHeight: 17 },
  taskStatusRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  taskStatusDone: { color: COLORS.success },
  archiveToggle: { alignItems: "center", borderColor: "#E7DDCF", borderRadius: 12, borderStyle: "dashed", borderWidth: 1, paddingVertical: 12, marginTop: 4 },
  archiveToggleText: { color: COLORS.primary, fontSize: 13, fontWeight: "800" },
  archiveHint: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10, marginTop: 26 },
  sectionTitle: { color: COLORS.heading, fontSize: 17, fontWeight: "800" },
  sectionMeta: { color: COLORS.muted, fontSize: 12, fontWeight: "600" },
  taskList: { gap: 10 },
  taskCard: { backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 16, borderWidth: 1, padding: 16 },
  taskCardPressed: { opacity: 0.78 },
  taskTopRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  taskStatus: { color: COLORS.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.1 },
  taskDue: { color: COLORS.muted, fontSize: 12 },
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
  completedHeading: { color: COLORS.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1, marginTop: 10, textTransform: "uppercase" },
  emptyCard: { alignItems: "center", backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 16, borderWidth: 1, paddingHorizontal: 24, paddingVertical: 28 },
  emptyIcon: { alignItems: "center", backgroundColor: COLORS.successBg, borderRadius: 24, height: 48, justifyContent: "center", width: 48 },
  emptyIconText: { color: COLORS.success, fontSize: 23, fontWeight: "800" },
  emptyTitle: { color: COLORS.heading, fontSize: 16, fontWeight: "800", marginTop: 14 },
  emptyBody: { color: COLORS.muted, fontSize: 13, lineHeight: 19, marginTop: 7, textAlign: "center" },
  offlineNote: { backgroundColor: "#FFF4E5", borderColor: "#F5D6A8", borderRadius: 12, borderWidth: 1, color: "#7A4B00", fontSize: 13, lineHeight: 18, marginBottom: 12, padding: 12 },
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