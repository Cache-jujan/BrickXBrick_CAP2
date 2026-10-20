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
import { getSession } from "@/lib/auth";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { NotificationBell } from "@/components/notification-bell";
import { SmBottomBar } from "@/components/sm-bottom-bar";

type FilterKey = "Today" | "Upcoming" | "Past due" | "Completed";
type CompletedView = "Recent" | "Archive";

const FILTERS: { key: FilterKey; label: string; icon: "calendar" | "clock.arrow.circlepath" | "exclamationmark.triangle.fill" | "checkmark.circle.fill"; tint: string; countBg: string }[] = [
  { key: "Today", label: "Today", icon: "calendar", tint: COLORS.primary, countBg: "#FFE3D1" },
  { key: "Upcoming", label: "Upcoming", icon: "clock.arrow.circlepath", tint: "#475569", countBg: "#E8ECF2" },
  { key: "Past due", label: "Past Due", icon: "exclamationmark.triangle.fill", tint: "#DC2626", countBg: "#FDE2E0" },
  { key: "Completed", label: "Completed", icon: "checkmark.circle.fill", tint: "#16A34A", countBg: "#DCFCE7" },
];

const LIST_TITLES: Record<FilterKey, string> = {
  Today: "Today's Tasks",
  Upcoming: "Upcoming Tasks",
  "Past due": "Past Due Tasks",
  Completed: "Completed Tasks",
};

const DAY_MS = 24 * 60 * 60 * 1000;
// A completed task moves to the Archive this many days after it was completed.
const ARCHIVE_AFTER_DAYS = 7;
const PROJECTS_PREVIEW = 3;
const TASKS_PREVIEW = 5;

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dueDay(task: AssignedTask): number | null {
  const due = new Date(task.duedate);
  return Number.isNaN(due.getTime()) ? null : startOfDay(due);
}

function isDone(task: AssignedTask) {
  return task.status === "Completed";
}

// completedat is only filled in for tasks acknowledged after the backend change;
// older ones fall back to lastupdatedat (the time the PM acknowledged them).
function completedAtOf(task: AssignedTask): Date | null {
  const raw = task.completedat || task.lastupdatedat;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isArchived(task: AssignedTask, today: number) {
  if (!isDone(task)) return false;
  const completed = completedAtOf(task);
  if (!completed) return false;
  return today - startOfDay(completed) >= ARCHIVE_AFTER_DAYS * DAY_MS;
}

// Today / Upcoming / Past due only look at tasks that are not completed yet.
function matchesFilter(task: AssignedTask, key: FilterKey, today: number) {
  if (key === "Completed") return isDone(task);
  if (isDone(task)) return false;
  const due = dueDay(task);
  if (due === null) return false;
  if (key === "Today") return due === today;
  if (key === "Upcoming") return due > today;
  return due < today;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "SM";
}

function shortDate(date: Date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dueLabel(task: AssignedTask, today: number) {
  const due = dueDay(task);
  if (due === null) return task.duedate;
  if (due === today) return "Today";
  if (due === today + DAY_MS) return "Tomorrow";
  return shortDate(new Date(task.duedate));
}

// Completed tasks show when they were finished instead of when they were due.
function rightLabel(task: AssignedTask, today: number) {
  if (isDone(task)) {
    const completed = completedAtOf(task);
    if (completed) return `Done ${shortDate(completed)}`;
  }
  return dueLabel(task, today);
}

type Badge = { label: string; bg: string; fg: string; tone: "done" | "late" | "active" | "review" | "idle" };

function badgeFor(task: AssignedTask, today: number): Badge {
  if (isDone(task)) return { label: "Completed", bg: COLORS.successBg, fg: "#166534", tone: "done" };
  // A submission is waiting for the PM; the task status itself does not
  // change until the PM acknowledges, so show it here.
  if (task.pendingphotoevidenceurl) return { label: "In Review", bg: "#EAF2FF", fg: "#2563EB", tone: "review" };
  if (task.latestreviewstatus === "Flagged") return { label: "Flagged", bg: "#FDE2E0", fg: "#B42318", tone: "late" };
  const due = dueDay(task);
  if (due !== null && due < today) return { label: "Overdue", bg: "#FDE2E0", fg: "#B42318", tone: "late" };
  if (task.status === "In Progress" || Number(task.completionpercentage || 0) > 0) {
    return { label: "In Progress", bg: "#FFF0E0", fg: "#C2410C", tone: "active" };
  }
  return { label: "Not Started", bg: "#EDEFF3", fg: "#475569", tone: "idle" };
}

type ProjectSummary = {
  name: string;
  total: number;
  done: number;
  pending: number;
  atRisk: boolean;
};

export default function SiteManagerHomeScreen() {
  const session = getSession();
  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("Today");
  const [completedView, setCompletedView] = useState<CompletedView>("Recent");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [showAllTasks, setShowAllTasks] = useState(false);

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

  const today = startOfDay(new Date());

  // Completed tasks older than ARCHIVE_AFTER_DAYS leave the working views (counts,
  // progress, project cards) and live in the Archive instead.
  const { activeTasks, archivedTasks } = useMemo(() => {
    const active: AssignedTask[] = [];
    const archived: AssignedTask[] = [];
    tasks.forEach((task) => (isArchived(task, today) ? archived : active).push(task));
    archived.sort((a, b) => (completedAtOf(b)?.getTime() ?? 0) - (completedAtOf(a)?.getTime() ?? 0));
    return { activeTasks: active, archivedTasks: archived };
  }, [tasks, today]);

  const counts = useMemo(() => {
    const result = {} as Record<FilterKey, number>;
    FILTERS.forEach(({ key }) => {
      result[key] = activeTasks.filter((task) => matchesFilter(task, key, today)).length;
    });
    return result;
  }, [activeTasks, today]);

  const doneCount = useMemo(() => activeTasks.filter(isDone).length, [activeTasks]);

  const projects = useMemo(() => {
    const byName = new Map<string, ProjectSummary>();
    activeTasks.forEach((task) => {
      const name = task.projectname || "Other tasks";
      if (!byName.has(name)) byName.set(name, { name, total: 0, done: 0, pending: 0, atRisk: false });
      const project = byName.get(name)!;
      project.total += 1;
      if (isDone(task)) project.done += 1;
      else {
        project.pending += 1;
        const due = dueDay(task);
        if (due !== null && due < today) project.atRisk = true;
      }
    });
    return Array.from(byName.values());
  }, [activeTasks, today]);

  const inProject = useCallback(
    (task: AssignedTask) => projectFilter === null || (task.projectname || "Other tasks") === projectFilter,
    [projectFilter]
  );

  const showingArchive = filter === "Completed" && completedView === "Archive";

  const visibleTasks = useMemo(
    () =>
      showingArchive
        ? archivedTasks.filter(inProject)
        : activeTasks.filter((task) => matchesFilter(task, filter, today) && inProject(task)),
    [showingArchive, archivedTasks, activeTasks, filter, today, inProject]
  );

  // Archive grouped by the month the task was completed, newest first.
  const archiveGroups = useMemo(() => {
    const groups: { label: string; tasks: AssignedTask[] }[] = [];
    visibleTasks.forEach((task) => {
      const completed = completedAtOf(task);
      const label = completed
        ? completed.toLocaleDateString(undefined, { month: "long", year: "numeric" })
        : "Earlier";
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.tasks.push(task);
      else groups.push({ label, tasks: [task] });
    });
    return groups;
  }, [visibleTasks]);

  if (!session || session.user.role !== "Site Manager") return <Redirect href="/login" />;

  const firstName = session.user.name.split(" ")[0] || "there";
  const shownProjects = showAllProjects ? projects : projects.slice(0, PROJECTS_PREVIEW);
  const shownTasks = showAllTasks ? visibleTasks : visibleTasks.slice(0, TASKS_PREVIEW);
  const percent = activeTasks.length === 0 ? 0 : Math.round((doneCount / activeTasks.length) * 100);

  const now = new Date();
  const dateWeekday = now.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
  const dateMonth = now.toLocaleDateString(undefined, { month: "short" }).toUpperCase();

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadTasks(true)} />}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.brandRow}>
            <BrickLogo />
            <View>
              <Text style={styles.brandName}>Brick x Brick</Text>
              <Text style={styles.brandTagline}>Build Today. Better Tomorrow.</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <NotificationBell color={COLORS.heading} />
            <Pressable
              onPress={() => router.push("/settings")}
              style={styles.avatar}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Open settings"
            >
              <Text style={styles.avatarText}>{initialsOf(session.user.name)}</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.title}>{greeting()}, {firstName}.</Text>
        <Text style={styles.subtitle}>Here’s your task progress.</Text>

        {/* Date + progress card */}
        <View style={styles.progressCard}>
          <View style={styles.dateTile} accessibilityLabel={now.toDateString()}>
            <Text style={styles.dateWeekday}>{dateWeekday}</Text>
            <Text style={styles.dateDay}>{now.getDate()}</Text>
            <Text style={styles.dateMonth}>{dateMonth}</Text>
          </View>
          <View style={styles.progressDivider} />
          <View style={styles.progressBody}>
            <Text style={styles.progressLabel}>Task Progress</Text>
            <Text style={styles.progressValue}>
              {loading ? "…" : `${doneCount} of ${activeTasks.length} tasks`}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${percent}%` }]} />
            </View>
          </View>
        </View>

        <Pressable
          style={styles.ticketButton}
          onPress={() => router.push("/ticket-request")}
          accessibilityRole="button"
          accessibilityLabel="Request ticket"
        >
          <Text style={styles.ticketButtonText}>＋  Request a ticket</Text>
        </Pressable>

        {/* Filter tabs */}
        <View style={styles.filterBar}>
          {FILTERS.map(({ key, label, icon, tint, countBg }, index) => {
            const active = filter === key;
            return (
              <Pressable
                key={key}
                onPress={() => { setFilter(key); setShowAllTasks(false); }}
                style={[styles.filterItem, index > 0 && !active && styles.filterItemDivider, active && styles.filterItemActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <IconSymbol name={icon} size={22} color={active ? "#FFFFFF" : tint} />
                <View style={styles.filterLabelRow}>
                  <Text style={[styles.filterLabel, active && styles.filterLabelActive]}>{label}</Text>
                  <View style={[styles.filterCount, { backgroundColor: active ? "rgba(255,255,255,0.28)" : countBg }]}>
                    <Text style={[styles.filterCountText, { color: active ? "#FFFFFF" : tint }]}>{counts[key]}</Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
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
            <Text style={styles.emptyBody}>Tasks assigned to you by your Project Manager will appear here.</Text>
          </View>
        ) : (
          <>
            {/* Your projects */}
            {projects.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Your Projects</Text>
                  {projects.length > PROJECTS_PREVIEW && (
                    <Pressable onPress={() => setShowAllProjects((v) => !v)} hitSlop={8}>
                      <Text style={styles.viewAll}>{showAllProjects ? "Show less" : "View All"} ›</Text>
                    </Pressable>
                  )}
                </View>
                <View style={styles.cardList}>
                  {shownProjects.map((project) => {
                    const selected = projectFilter === project.name;
                    const finished = project.pending === 0;
                    const pct = project.total === 0 ? 0 : Math.round((project.done / project.total) * 100);
                    const tone = finished
                      ? { label: "Done", bg: COLORS.successBg, fg: "#166534", bar: COLORS.success }
                      : project.atRisk
                      ? { label: "At Risk", bg: "#FFF0E0", fg: "#C2410C", bar: "#F59E0B" }
                      : { label: "On Track", bg: COLORS.successBg, fg: "#166534", bar: COLORS.success };
                    return (
                      <Pressable
                        key={project.name}
                        onPress={() => { setProjectFilter(selected ? null : project.name); setShowAllTasks(false); }}
                        style={[styles.projectCard, selected && styles.projectCardSelected]}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`${project.name}, ${project.pending} pending`}
                      >
                        <View style={styles.projectIcon}>
                          <Text style={styles.projectIconText}>▦</Text>
                        </View>
                        <View style={styles.projectBody}>
                          <View style={styles.projectTopRow}>
                            <Text style={styles.projectName} numberOfLines={1}>{project.name}</Text>
                            <View style={[styles.pill, { backgroundColor: tone.bg }]}>
                              <Text style={[styles.pillText, { color: tone.fg }]}>{tone.label}</Text>
                            </View>
                          </View>
                          <View style={styles.projectProgressRow}>
                            <View style={styles.projectTrack}>
                              <View style={[styles.projectFill, { width: `${pct}%`, backgroundColor: tone.bar }]} />
                            </View>
                            <Text style={styles.projectCount}>{project.done} / {project.total} tasks</Text>
                          </View>
                          <Text style={styles.projectPending}>
                            {project.pending === 0 ? "No pending tasks" : `${project.pending} pending`}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            {/* Tasks for the active filter */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{showingArchive ? "Archive" : LIST_TITLES[filter]}</Text>
              {!showingArchive && visibleTasks.length > TASKS_PREVIEW && (
                <Pressable onPress={() => setShowAllTasks((v) => !v)} hitSlop={8}>
                  <Text style={styles.viewAll}>{showAllTasks ? "Show less" : "View All"} ›</Text>
                </Pressable>
              )}
            </View>

            {filter === "Completed" && (
              <View style={styles.segment}>
                {(["Recent", "Archive"] as CompletedView[]).map((view) => {
                  const active = completedView === view;
                  const count = view === "Recent" ? counts.Completed : archivedTasks.length;
                  return (
                    <Pressable
                      key={view}
                      onPress={() => { setCompletedView(view); setShowAllTasks(false); }}
                      style={[styles.segmentItem, active && styles.segmentItemActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                        {view === "Recent" ? "Last 7 days" : "Archive"} ({count})
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {projectFilter && (
              <Pressable onPress={() => setProjectFilter(null)} style={styles.projectChip} accessibilityRole="button">
                <Text style={styles.projectChipText} numberOfLines={1}>{projectFilter}  ✕</Text>
              </Pressable>
            )}

            {visibleTasks.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>{showingArchive ? "Nothing archived yet" : `Nothing in “${filter}”`}</Text>
                <Text style={styles.emptyBody}>
                  {showingArchive
                    ? `Completed tasks move here ${ARCHIVE_AFTER_DAYS} days after they’re finished.`
                    : projectFilter
                    ? "No tasks match this project and filter."
                    : "No tasks match this filter right now."}
                </Text>
              </View>
            ) : showingArchive ? (
              archiveGroups.map((group) => (
                <View key={group.label} style={styles.archiveGroup}>
                  <Text style={styles.archiveMonth}>{group.label}</Text>
                  <View style={styles.cardList}>
                    {group.tasks.map((task) => <TaskRow key={task.taskid} task={task} today={today} />)}
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.cardList}>
                {shownTasks.map((task) => <TaskRow key={task.taskid} task={task} today={today} />)}
              </View>
            )}
          </>
        )}
      </ScrollView>
      <SmBottomBar />
    </SafeAreaView>
  );
}

function BrickLogo() {
  return (
    <View style={styles.logo}>
      <View style={styles.logoRow}>
        <View style={[styles.logoBrick, { width: 14 }]} />
        <View style={[styles.logoBrick, { width: 22 }]} />
      </View>
      <View style={styles.logoRow}>
        <View style={[styles.logoBrick, { width: 22 }]} />
        <View style={[styles.logoBrick, { width: 14 }]} />
      </View>
      <View style={styles.logoRow}>
        <View style={[styles.logoBrick, { width: 14 }]} />
        <View style={[styles.logoBrick, { width: 22 }]} />
      </View>
    </View>
  );
}

function TaskRow({ task, today }: { task: AssignedTask; today: number }) {
  const badge = badgeFor(task, today);
  const lead =
    badge.tone === "done"
      ? { bg: COLORS.success, border: COLORS.success, glyph: "✓", color: "#FFFFFF" }
      : badge.tone === "late"
      ? { bg: "#DC2626", border: "#DC2626", glyph: "!", color: "#FFFFFF" }
      : badge.tone === "idle"
      ? { bg: "transparent", border: "#334155", glyph: "", color: "#334155" }
      : { bg: "transparent", border: badge.tone === "review" ? "#2563EB" : COLORS.primary, glyph: "", color: COLORS.primary };

  return (
    <Pressable
      onPress={() => router.push(`/site-manager/task/${task.taskid}`)}
      style={({ pressed }) => [styles.taskRow, pressed && styles.pressed]}
    >
      <View style={[styles.taskLead, { backgroundColor: lead.bg, borderColor: lead.border }]}>
        {lead.glyph ? <Text style={[styles.taskLeadGlyph, { color: lead.color }]}>{lead.glyph}</Text> : null}
      </View>
      <View style={styles.taskBody}>
        <Text style={styles.taskName} numberOfLines={2}>{task.taskname}</Text>
        {task.projectname ? (
          <Text style={styles.taskProject} numberOfLines={1}>
            {task.projectname}{task.milestonename ? ` · ${task.milestonename}` : ""}
          </Text>
        ) : null}
      </View>
      <View style={styles.taskRight}>
        <Text style={styles.taskDue}>{rightLabel(task, today)}</Text>
        <View style={[styles.pill, { backgroundColor: badge.bg }]}>
          <Text style={[styles.pillText, { color: badge.fg }]}>{badge.label}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const CARD = { backgroundColor: "#FFFFFF", borderColor: "#ECE6DC", borderRadius: 16, borderWidth: 1 } as const;

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#F8F1E8", flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 28 },
  pressed: { opacity: 0.78 },

  headerRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  brandRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  brandName: { color: COLORS.heading, fontSize: 18, fontWeight: "800" },
  brandTagline: { color: COLORS.muted, fontSize: 11, marginTop: 1 },
  logo: { gap: 2 },
  logoRow: { flexDirection: "row", gap: 2 },
  logoBrick: { backgroundColor: COLORS.primary, borderRadius: 2, height: 8 },
  headerActions: { alignItems: "center", flexDirection: "row", gap: 12 },
  avatar: { alignItems: "center", backgroundColor: COLORS.primary, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  avatarText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },

  title: { color: "#111827", fontSize: 30, fontWeight: "800", letterSpacing: -0.5, marginTop: 22 },
  subtitle: { color: COLORS.muted, fontSize: 15, marginTop: 6 },

  progressCard: { ...CARD, alignItems: "center", flexDirection: "row", gap: 16, marginTop: 18, padding: 16 },
  dateTile: { alignItems: "center", backgroundColor: "#FFF3EA", borderColor: "#F8D3B8", borderRadius: 16, borderWidth: 1, justifyContent: "center", paddingVertical: 10, width: 88 },
  dateWeekday: { color: COLORS.primary, fontSize: 12, fontWeight: "800", letterSpacing: 1.2 },
  dateDay: { color: COLORS.heading, fontSize: 38, fontWeight: "800", lineHeight: 44 },
  dateMonth: { color: COLORS.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1.2 },
  progressDivider: { alignSelf: "stretch", backgroundColor: "#ECE6DC", width: 1 },
  progressBody: { flex: 1 },
  progressLabel: { color: COLORS.muted, fontSize: 14 },
  progressValue: { color: COLORS.heading, fontSize: 21, fontWeight: "800", marginTop: 4 },
  progressTrack: { backgroundColor: "#E6E9EE", borderRadius: 4, height: 8, marginTop: 12, overflow: "hidden" },
  progressFill: { backgroundColor: COLORS.success, borderRadius: 4, height: 8 },

  ticketButton: { alignItems: "center", borderColor: COLORS.primary, borderRadius: 14, borderWidth: 1.5, marginTop: 12, paddingVertical: 11 },
  ticketButtonText: { color: COLORS.primary, fontSize: 13, fontWeight: "800" },

  filterBar: { ...CARD, flexDirection: "row", marginTop: 14, overflow: "hidden" },
  filterItem: { alignItems: "center", flex: 1, gap: 6, justifyContent: "center", paddingVertical: 12 },
  filterItemDivider: { borderLeftColor: "#ECE6DC", borderLeftWidth: 1 },
  filterItemActive: { backgroundColor: COLORS.primary, borderRadius: 14, margin: 3 },
  filterLabelRow: { alignItems: "center", flexDirection: "row", gap: 4 },
  filterLabel: { color: COLORS.heading, fontSize: 11, fontWeight: "700" },
  filterLabelActive: { color: "#FFFFFF" },
  filterCount: { borderRadius: 10, minWidth: 18, paddingHorizontal: 5, paddingVertical: 1 },
  filterCountText: { fontSize: 11, fontWeight: "800", textAlign: "center" },

  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10, marginTop: 24 },
  sectionTitle: { color: COLORS.heading, fontSize: 19, fontWeight: "800" },
  viewAll: { color: COLORS.primary, fontSize: 13, fontWeight: "700" },
  cardList: { gap: 10 },

  segment: { backgroundColor: "#EFE7DA", borderRadius: 12, flexDirection: "row", marginBottom: 12, padding: 3 },
  segmentItem: { alignItems: "center", borderRadius: 10, flex: 1, paddingVertical: 8 },
  segmentItemActive: { backgroundColor: "#FFFFFF" },
  segmentText: { color: COLORS.muted, fontSize: 12, fontWeight: "700" },
  segmentTextActive: { color: COLORS.heading },
  archiveGroup: { marginBottom: 12 },
  archiveMonth: { color: COLORS.muted, fontSize: 12, fontWeight: "800", letterSpacing: 0.8, marginBottom: 8, textTransform: "uppercase" },

  projectCard: { ...CARD, alignItems: "center", flexDirection: "row", gap: 12, padding: 12 },
  projectCardSelected: { backgroundColor: "#FFF6EE", borderColor: COLORS.primary },
  projectIcon: { alignItems: "center", backgroundColor: "#E8F0FB", borderRadius: 12, height: 56, justifyContent: "center", width: 56 },
  projectIconText: { color: "#2F6FD0", fontSize: 26 },
  projectBody: { flex: 1 },
  projectTopRow: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  projectName: { color: COLORS.heading, flex: 1, fontSize: 15, fontWeight: "800" },
  projectProgressRow: { alignItems: "center", flexDirection: "row", gap: 10, marginTop: 10 },
  projectTrack: { backgroundColor: "#E6E9EE", borderRadius: 4, flex: 1, height: 7, overflow: "hidden" },
  projectFill: { borderRadius: 4, height: 7 },
  projectCount: { color: COLORS.muted, fontSize: 11, fontWeight: "600" },
  projectPending: { color: COLORS.muted, fontSize: 11, marginTop: 6 },
  projectChip: { alignSelf: "flex-start", backgroundColor: "#FFF0E6", borderRadius: 16, marginBottom: 10, maxWidth: "100%", paddingHorizontal: 12, paddingVertical: 6 },
  projectChipText: { color: COLORS.primary, fontSize: 12, fontWeight: "800" },

  pill: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 11, fontWeight: "800" },

  taskRow: { ...CARD, alignItems: "center", flexDirection: "row", gap: 12, padding: 14 },
  taskLead: { alignItems: "center", borderRadius: 16, borderWidth: 2.5, height: 32, justifyContent: "center", width: 32 },
  taskLeadGlyph: { fontSize: 16, fontWeight: "900" },
  taskBody: { flex: 1 },
  taskName: { color: COLORS.heading, fontSize: 15, fontWeight: "800", lineHeight: 20 },
  taskProject: { color: COLORS.muted, fontSize: 12, marginTop: 4 },
  taskRight: { alignItems: "flex-end", gap: 6 },
  taskDue: { color: COLORS.muted, fontSize: 12, fontWeight: "600" },

  emptyCard: { ...CARD, alignItems: "center", paddingHorizontal: 24, paddingVertical: 28 },
  emptyIcon: { alignItems: "center", backgroundColor: COLORS.successBg, borderRadius: 24, height: 48, justifyContent: "center", width: 48 },
  emptyIconText: { color: COLORS.success, fontSize: 23, fontWeight: "800" },
  emptyTitle: { color: COLORS.heading, fontSize: 16, fontWeight: "800", marginTop: 4 },
  emptyBody: { color: COLORS.muted, fontSize: 13, lineHeight: 19, marginTop: 7, textAlign: "center" },
  errorCard: { backgroundColor: "#FFF5F3", borderColor: "#F4C7C3", borderRadius: 16, borderWidth: 1, marginTop: 20, padding: 16 },
  errorTitle: { color: "#B42318", fontSize: 15, fontWeight: "800" },
  errorBody: { color: "#8C2D24", fontSize: 13, lineHeight: 19, marginTop: 6 },
  retryButton: { alignSelf: "flex-start", backgroundColor: COLORS.primary, borderRadius: 10, marginTop: 12, paddingHorizontal: 13, paddingVertical: 9 },
  retryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
});