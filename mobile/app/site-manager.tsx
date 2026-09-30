import { useCallback, useMemo, useState } from "react";
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
import { fetchAssignedTasks, type AssignedTask } from "@/lib/api";
import { getSession, logout } from "@/lib/auth";

type TaskFilter = "All" | "Active" | "Completed";

export default function SiteManagerHomeScreen() {
  const session = getSession();
  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [filter, setFilter] = useState<TaskFilter>("Active");
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
  const activeTasks = tasks.filter((task) => task.status !== "Completed");
  const completedTasks = tasks.filter((task) => task.status === "Completed");
  const visibleTasks = useMemo(() => {
    const filtered = filter === "All" ? tasks : filter === "Active" ? activeTasks : completedTasks;
    return [...filtered].sort((a, b) => new Date(a.duedate).getTime() - new Date(b.duedate).getTime());
  }, [activeTasks, completedTasks, filter, tasks]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadTasks(true)} />}
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

        <Text style={styles.actionHeading}>What do you need to do?</Text>
        <View style={styles.actionGrid}>
          <Pressable style={[styles.actionCard, styles.actionCardPrimary]} onPress={() => router.push("/ticket-request")}>
            <Text style={styles.actionIcon}>＋</Text>
            <Text style={[styles.actionLabel, styles.actionLabelPrimary]}>Request ticket</Text>
            <Text style={styles.actionHint}>Ask for materials or work</Text>
          </Pressable>
          <Pressable style={styles.actionCard} onPress={() => router.push("/(tabs)")}>
            <Text style={styles.actionIcon}>▣</Text>
            <Text style={styles.actionLabel}>Submit receipt</Text>
            <Text style={styles.actionHint}>Record a completed purchase</Text>
          </Pressable>
          <Pressable style={styles.actionCard} onPress={() => loadTasks(true)}>
            <Text style={styles.actionIcon}>↻</Text>
            <Text style={styles.actionLabel}>Refresh tasks</Text>
            <Text style={styles.actionHint}>Check for new assignments</Text>
          </Pressable>
        </View>

        <View style={styles.summaryCard}>
          <View>
            <Text style={styles.summaryLabel}>MY TASKS</Text>
            <Text style={styles.summaryTitle}>Stay on top of today’s work</Text>
            <Text style={styles.summaryBody}>
              {loading ? "Checking your assigned tasks…" : `${activeTasks.length} task${activeTasks.length === 1 ? "" : "s"} need your attention.`}
            </Text>
          </View>
          <View style={styles.summaryIcon}><View style={styles.checkLine} /></View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Assigned tasks</Text>
          <Text style={styles.sectionMeta}>{visibleTasks.length} shown</Text>
        </View>
        <View style={styles.filterRow}>
          {(["All", "Active", "Completed"] as TaskFilter[]).map((value) => (
            <Pressable key={value} onPress={() => setFilter(value)} style={[styles.filterChip, filter === value && styles.filterChipActive]}>
              <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>
                {value} ({value === "All" ? tasks.length : value === "Active" ? activeTasks.length : completedTasks.length})
              </Text>
            </Pressable>
          ))}
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Couldn’t load tasks</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Pressable onPress={() => loadTasks()} style={styles.retryButton}><Text style={styles.retryText}>Try again</Text></Pressable>
          </View>
        ) : loading ? (
          <View style={styles.emptyCard}><ActivityIndicator color={COLORS.primary} /><Text style={styles.emptyBody}>Loading assigned tasks…</Text></View>
        ) : visibleTasks.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}><Text style={styles.emptyIconText}>✓</Text></View>
            <Text style={styles.emptyTitle}>{filter === "Completed" ? "No completed tasks yet" : "No active tasks"}</Text>
            <Text style={styles.emptyBody}>Tasks assigned to you by your Project Manager will appear here.</Text>
          </View>
        ) : (
          <View style={styles.taskList}>{visibleTasks.map((task) => <TaskCard key={task.taskid} task={task} />)}</View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TaskCard({ task }: { task: AssignedTask }) {
  const completed = task.status === "Completed";
  const dueDate = new Date(task.duedate);
  const formattedDueDate = Number.isNaN(dueDate.getTime()) ? task.duedate : dueDate.toLocaleDateString();

  return (
    <Pressable onPress={() => router.push(`/site-manager/task/${task.taskid}`)} style={({ pressed }) => [styles.taskCard, pressed && styles.taskCardPressed]}>
      <View style={styles.taskTopRow}>
        <Text style={styles.taskStatus}>{completed ? "COMPLETED" : "ASSIGNED"}</Text>
        <Text style={styles.taskDue}>Due {formattedDueDate}</Text>
      </View>
      <Text style={styles.taskName}>{task.taskname}</Text>
      <View style={styles.taskBottomRow}>
        <Text style={styles.taskProgress}>{Number(task.completionpercentage || 0)}% complete</Text>
        <View style={[styles.statusPill, completed && styles.statusPillCompleted]}><Text style={[styles.statusPillText, completed && styles.statusPillTextCompleted]}>{task.status}</Text></View>
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
  actionHeading: { color: COLORS.heading, fontSize: 17, fontWeight: "800", marginTop: 24, marginBottom: 10 },
  actionGrid: { flexDirection: "row", gap: 9 },
  actionCard: { alignItems: "flex-start", backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 14, borderWidth: 1, flex: 1, minHeight: 118, padding: 12 },
  actionCardPrimary: { backgroundColor: "#1A1A1A", borderColor: "#1A1A1A" },
  actionIcon: { color: COLORS.primary, fontSize: 22, fontWeight: "700" },
  actionLabel: { color: COLORS.heading, fontSize: 12, fontWeight: "800", marginTop: 8 },
  actionLabelPrimary: { color: "#FFFFFF" },
  actionHint: { color: COLORS.muted, fontSize: 10, lineHeight: 14, marginTop: 5 },
  summaryCard: { backgroundColor: "#1A1A1A", borderRadius: 18, flexDirection: "row", justifyContent: "space-between", marginTop: 22, minHeight: 150, overflow: "hidden", padding: 20 },
  summaryLabel: { color: "#D8C7AA", fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  summaryTitle: { color: "#FFFFFF", fontSize: 21, fontWeight: "800", lineHeight: 27, marginTop: 12, maxWidth: 230 },
  summaryBody: { color: "#C9C0B3", fontSize: 13, lineHeight: 19, marginTop: 10, maxWidth: 230 },
  summaryIcon: { alignItems: "center", backgroundColor: COLORS.primary, borderRadius: 28, height: 56, justifyContent: "center", width: 56 },
  checkLine: { borderBottomColor: "#FFFFFF", borderBottomWidth: 3, borderRightColor: "#FFFFFF", borderRightWidth: 3, height: 19, transform: [{ rotate: "45deg" }], width: 11 },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10, marginTop: 26 },
  sectionTitle: { color: COLORS.heading, fontSize: 17, fontWeight: "800" },
  sectionMeta: { color: COLORS.muted, fontSize: 12, fontWeight: "600" },
  filterRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  filterChip: { backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 20, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 8 },
  filterChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterText: { color: COLORS.muted, fontSize: 11, fontWeight: "700" },
  filterTextActive: { color: "#FFFFFF" },
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
});
