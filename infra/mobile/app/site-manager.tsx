import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Redirect, router, useFocusEffect } from "expo-router";

import { COLORS } from "@/constants/expense-flow-colors";
import { fetchAssignedTasks, type AssignedTask } from "@/lib/api";
import { getSession, logout } from "@/lib/auth";

export default function SiteManagerHomeScreen() {
  const session = getSession();
  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      setTasks(await fetchAssignedTasks());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load assigned tasks.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (session?.user.role === "Site Manager") loadTasks();
    }, [loadTasks, session?.user.role])
  );

  if (!session || session.user.role !== "Site Manager") return <Redirect href="/login" />;

  const firstName = session.user.name.split(" ")[0] || "there";
  const pendingTasks = tasks.filter((task) => task.status !== "Completed");
  const completedTasks = tasks.filter((task) => task.status === "Completed");

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
          <Pressable onPress={() => { logout(); router.replace("/login"); }} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Log out</Text>
          </Pressable>
        </View>

        <Text style={styles.subtitle}>Keep your site work moving and up to date.</Text>

        <View style={styles.summaryCard}>
          <View>
            <Text style={styles.summaryLabel}>MY TASKS</Text>
            <Text style={styles.summaryTitle}>Stay on top of today’s work</Text>
            <Text style={styles.summaryBody}>
              {loading ? "Checking your assigned tasks…" : `${pendingTasks.length} task${pendingTasks.length === 1 ? "" : "s"} need your attention.`}
            </Text>
          </View>
          <View style={styles.summaryIcon}>
            <View style={styles.checkLine} />
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Assigned tasks</Text>
          <Text style={styles.sectionMeta}>{tasks.length} total</Text>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Couldn’t load tasks</Text>
            <Text style={styles.errorBody}>{error}</Text>
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
            {pendingTasks.map((task) => <TaskCard key={task.taskid} task={task} />)}
            {completedTasks.length > 0 && (
              <Text style={styles.completedHeading}>Completed</Text>
            )}
            {completedTasks.map((task) => <TaskCard key={task.taskid} task={task} />)}
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Quick actions</Text>
        </View>
        <View style={styles.actionGrid}>
          <Pressable style={styles.actionCard} onPress={() => loadTasks(true)}>
            <Text style={styles.actionIcon}>↻</Text>
            <Text style={styles.actionLabel}>Refresh tasks</Text>
          </Pressable>
          <View style={styles.actionCard}>
            <Text style={styles.actionIcon}>↗</Text>
            <Text style={styles.actionLabel}>My updates</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function TaskCard({ task }: { task: AssignedTask }) {
  const completed = task.status === "Completed";
  const dueDate = new Date(task.duedate);
  const formattedDueDate = Number.isNaN(dueDate.getTime())
    ? task.duedate
    : dueDate.toLocaleDateString();

  return (
    <Pressable
      onPress={() => router.push(`/site-manager/task/${task.taskid}`)}
      style={({ pressed }) => [styles.taskCard, pressed && styles.taskCardPressed]}
    >
      <View style={styles.taskTopRow}>
        <Text style={styles.taskStatus}>{completed ? "COMPLETED" : "ASSIGNED"}</Text>
        <Text style={styles.taskDue}>Due {formattedDueDate}</Text>
      </View>
      <Text style={styles.taskName}>{task.taskname}</Text>
      <View style={styles.taskBottomRow}>
        <Text style={styles.taskProgress}>{Number(task.completionpercentage || 0)}% complete</Text>
        <View style={[styles.statusPill, completed && styles.statusPillCompleted]}>
          <Text style={[styles.statusPillText, completed && styles.statusPillTextCompleted]}>
            {task.status}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#F8F1E8", flex: 1 },
  content: { padding: 20, paddingBottom: 36 },
  headerRow: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  eyebrow: { color: COLORS.primary, fontSize: 11, fontWeight: "800", letterSpacing: 1.5, marginBottom: 7 },
  title: { color: "#1A1A1A", fontSize: 25, fontWeight: "800", letterSpacing: -0.4, maxWidth: 250 },
  subtitle: { color: COLORS.muted, fontSize: 14, lineHeight: 21, marginTop: 10 },
  logoutButton: { borderColor: "#D8CDBD", borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  logoutText: { color: COLORS.heading, fontSize: 12, fontWeight: "700" },
  summaryCard: { backgroundColor: "#1A1A1A", borderRadius: 18, flexDirection: "row", justifyContent: "space-between", marginTop: 24, minHeight: 160, overflow: "hidden", padding: 20 },
  summaryLabel: { color: "#D8C7AA", fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  summaryTitle: { color: "#FFFFFF", fontSize: 21, fontWeight: "800", lineHeight: 27, marginTop: 12, maxWidth: 230 },
  summaryBody: { color: "#C9C0B3", fontSize: 13, lineHeight: 19, marginTop: 10, maxWidth: 230 },
  summaryIcon: { alignItems: "center", backgroundColor: COLORS.primary, borderRadius: 28, height: 56, justifyContent: "center", width: 56 },
  checkLine: { borderBottomColor: "#FFFFFF", borderBottomWidth: 3, borderRightColor: "#FFFFFF", borderRightWidth: 3, height: 19, transform: [{ rotate: "45deg" }], width: 11 },
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
  errorCard: { backgroundColor: "#FFF5F3", borderColor: "#F4C7C3", borderRadius: 16, borderWidth: 1, padding: 16 },
  errorTitle: { color: "#B42318", fontSize: 15, fontWeight: "800" },
  errorBody: { color: "#8C2D24", fontSize: 13, lineHeight: 19, marginTop: 6 },
  retryButton: { alignSelf: "flex-start", backgroundColor: COLORS.primary, borderRadius: 10, marginTop: 12, paddingHorizontal: 13, paddingVertical: 9 },
  retryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  actionGrid: { flexDirection: "row", gap: 12 },
  actionCard: { alignItems: "center", backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 14, borderWidth: 1, flex: 1, minHeight: 92, justifyContent: "center" },
  actionIcon: { color: COLORS.primary, fontSize: 24, fontWeight: "700" },
  actionLabel: { color: COLORS.heading, fontSize: 13, fontWeight: "700", marginTop: 8 },
});
