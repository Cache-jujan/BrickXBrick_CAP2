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
import { Redirect, router, useFocusEffect, type Href } from "expo-router";

import { COLORS, FONT } from "@/constants/expense-flow-colors";
import { type AssignedTask } from "@/lib/api";
import { loadAssignedTasks } from "@/lib/cached-api";
import { getSession } from "@/lib/auth";
import { useOnNewNotifications } from "@/lib/notification-events";
import { ARCHIVE_AFTER_DAYS, dueLabel, projectSummaries, splitTasks, toDay } from "@/lib/sm-dashboard";
import { getPendingTaskUpdateForTask } from "@/lib/sync/db";
import { describeLoadError } from "@/lib/sync/messages";
import { useNetwork } from "@/lib/sync/network-context";
import { savedAtLabel } from "@/lib/sync/offline-cache";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { MainHeader } from "@/components/main-header";
import { SmBottomBar } from "@/components/sm-bottom-bar";
import { AppButton } from "@/components/app-button";
import { StateCard } from "@/components/state-card";

type FilterKey = "Today" | "Upcoming" | "Past due" | "Completed";
type CompletedView = "Recent" | "Archive";
type DueTone = "late" | "today" | "soon" | "normal";

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

const PROJECTS_PREVIEW = 3;
const TASKS_PREVIEW = 5;

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dueDay(task: AssignedTask): number | null {
  return toDay(task.duedate)?.getTime() ?? null;
}

function isDone(task: AssignedTask) {
  return task.status === "Completed";
}

// When a task was completed (completedat; older ones fall back to lastupdatedat).
function completedOn(task: AssignedTask): Date | null {
  const raw = task.completedat || task.lastupdatedat;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
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

function formatDay(value?: string | null) {
  const day = toDay(value);
  return day ? day.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
}

// Right-hand label of a task row: when it was finished, or how close the deadline is.
function rightLabel(task: AssignedTask): { text: string; tone: DueTone } {
  if (isDone(task)) {
    const done = completedOn(task);
    if (done) return { text: `Done ${done.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`, tone: "normal" };
  }
  return dueLabel(task.duedate);
}

type Badge = { label: string; bg: string; fg: string; tone: "done" | "late" | "active" | "review" | "idle" };

function badgeFor(task: AssignedTask, today: number): Badge {
  if (isDone(task)) return { label: "Completed", bg: COLORS.successBg, fg: "#166534", tone: "done" };
  // F10: an update saved on this phone and not sent yet.
  if (getPendingTaskUpdateForTask(task.taskid)) return { label: "Queued on phone", bg: "#FFF8E6", fg: "#8A5A00", tone: "review" };
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
  // Set when the list on screen is the copy saved on this phone (offline).
  const [savedAt, setSavedAt] = useState<string | null>(null);

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

  // open: not completed. recent: completed in the last 7 days. archived: older
  // (lib/sm-dashboard.js). Counts, progress and project cards use open + recent.
  const { open, recent, archived } = useMemo(() => splitTasks(tasks), [tasks]);
  const activeTasks = useMemo(() => [...open, ...recent], [open, recent]);

  const counts = useMemo(() => {
    const result = {} as Record<FilterKey, number>;
    FILTERS.forEach(({ key }) => {
      result[key] = key === "Completed" ? recent.length : open.filter((task) => matchesFilter(task, key, today)).length;
    });
    return result;
  }, [open, recent, today]);

  const dueToday = open.filter((task) => dueLabel(task.duedate).tone === "today").length;
  const overdue = open.filter((task) => dueLabel(task.duedate).tone === "late").length;
  const doneCount = recent.length;

  // Project dates and the nearest open deadline, shown on each project card.
  const projectInfo = useMemo(() => {
    const byName = new Map<string, ReturnType<typeof projectSummaries>[number]>();
    projectSummaries(activeTasks).forEach((p) => byName.set(p.name, p));
    return byName;
  }, [activeTasks]);

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

  const visibleTasks = useMemo(() => {
    const base =
      filter === "Completed"
        ? (completedView === "Archive" ? archived : recent)
        : open.filter((task) => matchesFilter(task, filter, today));
    return base.filter(inProject);
  }, [filter, completedView, archived, recent, open, today, inProject]);

  // Archive grouped by the month the task was completed, newest first.
  const archiveGroups = useMemo(() => {
    const groups: { label: string; tasks: AssignedTask[] }[] = [];
    visibleTasks.forEach((task) => {
      const done = completedOn(task);
      const label = done ? done.toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "Earlier";
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

  // Monday to Sunday of this week, with a dot on days that have an open deadline.
  const openDueDays = new Set(open.map(dueDay).filter((d): d is number => d !== null));
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
    return {
      time: d.getTime(),
      name: d.toLocaleDateString(undefined, { weekday: "short" }),
      num: d.getDate(),
      isToday: d.getTime() === today,
      hasDue: openDueDays.has(d.getTime()),
    };
  });

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <MainHeader tagline="Build Today. Better Tomorrow." />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadTasks(true)} />}
      >
        <Text style={styles.title}>{greeting()}, {firstName}.</Text>
        <Text style={styles.subtitle}>Here’s your task progress.</Text>

        {(!isOnline || savedAt) && (
          <Text style={styles.offlineNote}>
            {savedAt
              ? `${isOnline ? "Can't reach the server" : "You're offline"} · showing your tasks ${savedAtLabel(savedAt)}. You can open a task and queue an update; it is sent when you're back online.`
              : tasks.length > 0
                ? "You're offline. Showing your tasks as last loaded. You can still open a task and queue an update."
                : "You're offline, and your tasks haven't been saved on this phone yet. Open the app once with a connection; after that it works offline."}
          </Text>
        )}

        {/* Today summary */}
        <View style={styles.heroCard}>
          <View style={styles.dateTile} accessibilityLabel={now.toDateString()}>
            <Text style={styles.dateWeekday}>{dateWeekday}</Text>
            <Text style={styles.dateDay}>{now.getDate()}</Text>
            <Text style={styles.dateMonth}>{dateMonth}</Text>
          </View>
          <View style={styles.progressBody}>
            <Text style={styles.heroLabel}>Task progress</Text>
            <Text style={styles.heroValue}>
              {loading ? "…" : `${doneCount} of ${activeTasks.length} tasks`}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${percent}%` }]} />
            </View>
            {!loading && (dueToday > 0 || overdue > 0) && (
              <Text style={styles.heroAlert}>
                {[overdue > 0 && `${overdue} overdue`, dueToday > 0 && `${dueToday} due today`].filter(Boolean).join(" · ")}
              </Text>
            )}
          </View>
        </View>

        {/* This week: a dot marks a day with an open deadline */}
        <View style={styles.weekRow} accessibilityLabel="This week">
          {weekDays.map((day) => (
            <View key={day.time} style={[styles.weekDay, day.isToday && styles.weekDayToday]}>
              <Text style={[styles.weekName, day.isToday && styles.weekTextToday]}>{day.name}</Text>
              <Text style={[styles.weekNum, day.isToday && styles.weekTextToday]}>{day.num}</Text>
              <View style={[styles.weekDot, day.hasDue && { backgroundColor: day.isToday ? "#FFFFFF" : COLORS.primary }]} />
            </View>
          ))}
        </View>

        <AppButton
          label="＋  Request a ticket"
          variant="primary"
          onPress={() => router.push("/ticket-request")}
          accessibilityLabel="Request ticket"
          style={styles.ticketButton}
        />
        <AppButton
          label="Progress check-in"
          variant="secondary"
          onPress={() => router.push("/site-manager/checkin" as Href)}
          accessibilityLabel="Daily progress check-in"
          style={styles.ticketButton}
        />

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
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.filterLabel, active && styles.filterLabelActive]}>{label}</Text>
                  <View style={[styles.filterCount, { backgroundColor: active ? "rgba(255,255,255,0.28)" : countBg }]}>
                    <Text style={[styles.filterCountText, { color: active ? "#FFFFFF" : tint }]}>{counts[key]}</Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>

        {shownError ? (
          <View style={styles.stateWrap}>
            <StateCard kind="error" title="Couldn’t load tasks" body={shownError} onRetry={() => loadTasks()} />
          </View>
        ) : loading ? (
          <View style={styles.stateWrap}>
            <StateCard kind="loading" body="Loading assigned tasks…" />
          </View>
        ) : tasks.length === 0 ? (
          <View style={styles.stateWrap}>
            <StateCard kind="empty" title="No tasks to show yet" body="Tasks assigned to you by your Project Manager will appear here." />
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
                    const info = projectInfo.get(project.name);
                    const next = info?.next ? dueLabel(info.next.date) : null;
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
                          <Text style={styles.projectName} numberOfLines={2}>{project.name}</Text>
                          <View style={[styles.pill, styles.projectPill, { backgroundColor: tone.bg }]}>
                            <Text style={[styles.pillText, { color: tone.fg }]}>{tone.label}</Text>
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
                          {info?.startDate && (
                            <Text style={styles.projectMeta}>
                              {formatDay(info.startDate)} – {info.endDate ? formatDay(info.endDate) : "no end date"}
                            </Text>
                          )}
                          {info?.next && next && (
                            <Text style={[styles.projectMeta, DUE_TONE[next.tone]]} numberOfLines={2}>
                              Nearest deadline: {info.next.label} · {next.text}
                            </Text>
                          )}
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
                  const count = view === "Recent" ? recent.length : archived.length;
                  return (
                    <Pressable
                      key={view}
                      onPress={() => { setCompletedView(view); setShowAllTasks(false); }}
                      style={[styles.segmentItem, active && styles.segmentItemActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                        {view === "Recent" ? `Last ${ARCHIVE_AFTER_DAYS} days` : "Archive"} ({count})
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
              <StateCard
                kind="empty"
                title={showingArchive ? "Nothing archived yet" : `Nothing in “${filter}”`}
                body={
                  showingArchive
                    ? `Completed tasks move here ${ARCHIVE_AFTER_DAYS} days after they’re finished.`
                    : projectFilter
                    ? "No tasks match this project and filter."
                    : "No tasks match this filter right now."
                }
              />
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

function TaskRow({ task, today }: { task: AssignedTask; today: number }) {
  const badge = badgeFor(task, today);
  const right = rightLabel(task);
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
        <Text style={[styles.taskDue, DUE_TONE[right.tone]]}>{right.text}</Text>
        <View style={[styles.pill, { backgroundColor: badge.bg }]}>
          <Text style={[styles.pillText, { color: badge.fg }]}>{badge.label}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const DUE_TONE = StyleSheet.create({
  late: { color: "#D92D20", fontFamily: FONT.extrabold },
  today: { color: "#E85D0C", fontFamily: FONT.extrabold },
  soon: { color: "#B45309", fontFamily: FONT.bold },
  normal: {},
});

const CARD = { backgroundColor: "#FFFFFF", borderColor: "#ECE6DC", borderRadius: 16, borderWidth: 1 } as const;

const styles = StyleSheet.create({
  safeArea: { backgroundColor: COLORS.bgWarm, flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 28 },
  pressed: { opacity: 0.78 },


  title: { color: COLORS.heading, fontSize: 28, fontFamily: FONT.extrabold, letterSpacing: -0.5, marginTop: 14 },
  subtitle: { fontFamily: FONT.regular, color: COLORS.muted, fontSize: 15, marginTop: 6 },
  offlineNote: { fontFamily: FONT.regular, backgroundColor: "#FFF4E5", borderColor: "#F5D6A8", borderRadius: 12, borderWidth: 1, color: "#7A4B00", fontSize: 13, lineHeight: 18, marginTop: 14, padding: 12 },

  heroCard: { alignItems: "center", backgroundColor: COLORS.primary, borderRadius: 24, flexDirection: "row", gap: 16, marginTop: 18, padding: 16 },
  dateTile: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 18, justifyContent: "center", paddingVertical: 10, width: 84 },
  dateWeekday: { color: COLORS.primary, fontSize: 12, fontFamily: FONT.extrabold, letterSpacing: 1.2 },
  dateDay: { color: COLORS.heading, fontSize: 36, fontFamily: FONT.extrabold, lineHeight: 44, includeFontPadding: false },
  dateMonth: { color: COLORS.muted, fontSize: 12, fontFamily: FONT.extrabold, letterSpacing: 1.2 },
  heroLabel: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontFamily: FONT.medium },
  heroValue: { color: "#FFFFFF", fontSize: 21, fontFamily: FONT.extrabold, marginTop: 3 },
  heroAlert: { color: "#FFFFFF", fontSize: 12, fontFamily: FONT.bold, marginTop: 8 },

  weekRow: { flexDirection: "row", gap: 6, marginTop: 14 },
  weekDay: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#ECE6DC", borderRadius: 16, borderWidth: 1, flex: 1, gap: 2, paddingVertical: 8 },
  weekDayToday: { backgroundColor: COLORS.heading, borderColor: COLORS.heading },
  weekName: { color: COLORS.muted, fontSize: 11, fontFamily: FONT.semibold },
  weekNum: { color: COLORS.heading, fontSize: 15, fontFamily: FONT.extrabold },
  weekTextToday: { color: "#FFFFFF" },
  weekDot: { backgroundColor: "transparent", borderRadius: 3, height: 6, marginTop: 2, width: 6 },
  progressBody: { flex: 1 },
  
  
  progressTrack: { backgroundColor: "rgba(255,255,255,0.3)", borderRadius: 4, height: 8, marginTop: 12, overflow: "hidden" },
  progressFill: { backgroundColor: "#FFFFFF", borderRadius: 4, height: 8 },
  

  ticketButton: { marginTop: 12 },
  stateWrap: { marginTop: 20 },

  filterBar: { ...CARD, flexDirection: "row", marginTop: 14, overflow: "hidden" },
  filterItem: { alignItems: "center", flex: 1, gap: 6, justifyContent: "center", paddingVertical: 12 },
  filterItemDivider: { borderLeftColor: "#ECE6DC", borderLeftWidth: 1 },
  filterItemActive: { backgroundColor: COLORS.primary, borderRadius: 14, margin: 3 },
  filterLabelRow: { alignItems: "center", flexDirection: "row", gap: 4, maxWidth: "100%", paddingHorizontal: 2 },
  filterLabel: { flexShrink: 1, color: COLORS.heading, fontSize: 11, fontFamily: FONT.bold },
  filterLabelActive: { color: "#FFFFFF" },
  filterCount: { borderRadius: 10, minWidth: 18, paddingHorizontal: 5, paddingVertical: 1 },
  filterCountText: { fontSize: 11, fontFamily: FONT.extrabold, textAlign: "center" },

  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10, marginTop: 24 },
  sectionTitle: { color: COLORS.heading, fontSize: 19, fontFamily: FONT.extrabold },
  viewAll: { color: COLORS.primary, fontSize: 13, fontFamily: FONT.bold },
  cardList: { gap: 10 },

  segment: { backgroundColor: "#EFE7DA", borderRadius: 12, flexDirection: "row", marginBottom: 12, padding: 3 },
  segmentItem: { alignItems: "center", borderRadius: 10, flex: 1, paddingVertical: 8 },
  segmentItemActive: { backgroundColor: "#FFFFFF" },
  segmentText: { color: COLORS.muted, fontSize: 12, fontFamily: FONT.bold },
  segmentTextActive: { color: COLORS.heading },
  archiveGroup: { marginBottom: 12 },
  archiveMonth: { color: COLORS.muted, fontSize: 12, fontFamily: FONT.extrabold, letterSpacing: 0.8, marginBottom: 8, textTransform: "uppercase" },

  projectCard: { ...CARD, alignItems: "flex-start", flexDirection: "row", gap: 12, padding: 14 },
  projectCardSelected: { backgroundColor: "#FFF6EE", borderColor: COLORS.primary },
  projectIcon: { alignItems: "center", backgroundColor: "#E8F0FB", borderRadius: 14, height: 44, justifyContent: "center", width: 44 },
  projectIconText: { color: "#2F6FD0", fontSize: 22 },
  projectBody: { flex: 1 },
  projectName: { color: COLORS.heading, fontSize: 15, lineHeight: 20, fontFamily: FONT.extrabold },
  projectProgressRow: { alignItems: "center", flexDirection: "row", gap: 10, marginTop: 10 },
  projectTrack: { backgroundColor: "#E6E9EE", borderRadius: 4, flex: 1, height: 7, overflow: "hidden" },
  projectFill: { borderRadius: 4, height: 7 },
  projectCount: { color: COLORS.muted, fontSize: 11, fontFamily: FONT.semibold },
  projectPending: { fontFamily: FONT.regular, color: COLORS.muted, fontSize: 11, marginTop: 6 },
  projectMeta: { fontFamily: FONT.regular, color: COLORS.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  projectChip: { alignSelf: "flex-start", backgroundColor: "#FFF0E6", borderRadius: 16, marginBottom: 10, maxWidth: "100%", paddingHorizontal: 12, paddingVertical: 6 },
  projectChipText: { color: COLORS.primary, fontSize: 12, fontFamily: FONT.extrabold },

  projectPill: { alignSelf: "flex-start", marginTop: 6 },
  pill: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 11, fontFamily: FONT.extrabold },

  taskRow: { ...CARD, alignItems: "center", flexDirection: "row", gap: 12, padding: 14 },
  taskLead: { alignItems: "center", borderRadius: 16, borderWidth: 2.5, height: 32, justifyContent: "center", width: 32 },
  taskLeadGlyph: { fontSize: 16, fontFamily: FONT.extrabold },
  taskBody: { flex: 1 },
  taskName: { color: COLORS.heading, fontSize: 15, fontFamily: FONT.extrabold, lineHeight: 20 },
  taskProject: { fontFamily: FONT.regular, color: COLORS.muted, fontSize: 12, marginTop: 4 },
  taskRight: { alignItems: "flex-end", gap: 6 },
  taskDue: { color: COLORS.muted, fontSize: 12, fontFamily: FONT.semibold },

});