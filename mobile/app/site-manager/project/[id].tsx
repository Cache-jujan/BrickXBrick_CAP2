import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, router, useFocusEffect, useLocalSearchParams, type Href } from "expo-router";

import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { type AssignedTask, type SiteProject } from "@/lib/api";
import { loadAssignedTasks, loadMyProjects } from "@/lib/cached-api";
import { getSession } from "@/lib/auth";
import { daysUntil, dueLabel, toDay } from "@/lib/sm-dashboard";
import { describeLoadError } from "@/lib/sync/messages";
import { useNetwork } from "@/lib/sync/network-context";
import { savedAtLabel } from "@/lib/sync/offline-cache";
import { useLocale } from "@/lib/i18n-context";
import { useScreenInsets } from "@/hooks/use-screen-insets";
import { AppButton } from "@/components/app-button";
import { FlowHeader } from "@/components/flow-header";
import { Screen } from "@/components/screen";
import { StateCard } from "@/components/state-card";
import { StatusChip, type ChipTone } from "@/components/status-chip";
import { IconSymbol } from "@/components/ui/icon-symbol";

const TASKS_SHOWN = 5;

const DUE_COLOR = { late: "#D92D20", today: "#E85D0C", soon: "#B45309", normal: COLORS.muted } as const;

// Project status from the server -> chip colour. The words come from tv("status", ...).
const STATUS_TONE: Record<string, ChipTone> = { Active: "info", Completed: "success", Cancelled: "error", Draft: "neutral" };

// Site Manager: one assigned project in full. Everything here comes from the
// server (GET /api/projects for this person's project, GET /api/tasks/assigned
// for their tasks on it); nothing is made up, and there is no budget because the
// Site Manager is not allowed to see it.
export default function SiteManagerProjectScreen() {
  const { t, tv, formatDate, intlLocale } = useLocale();
  const session = getSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useScreenInsets();
  const { isOnline } = useNetwork();

  const [project, setProject] = useState<SiteProject | null>(null);
  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [projects, assigned] = await Promise.all([loadMyProjects(), loadAssignedTasks()]);
      setProject(projects.data.find((p) => p.projectid === id) ?? null);
      setTasks(assigned.data.filter((task) => task.projectid === id));
      setSavedAt(projects.fromCache || assigned.fromCache ? (projects.fromCache ? projects.savedAt : assigned.savedAt) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sm.proj_err_load"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the project changes, not on a language change
  }, [id]);

  useFocusEffect(useCallback(() => { if (session?.user.role === "Site Manager") load(); }, [load, session?.user.role]));

  const open = useMemo(
    () => tasks.filter((task) => task.status !== "Completed")
      .sort((a, b) => (toDay(a.duedate)?.getTime() ?? Infinity) - (toDay(b.duedate)?.getTime() ?? Infinity)),
    [tasks]
  );
  const done = tasks.length - open.length;
  const overdue = open.filter((task) => dueLabel(task.duedate).tone === "late").length;

  if (!session || session.user.role !== "Site Manager") return <Redirect href="/login" />;

  const day = (value?: string | null) => {
    const d = toDay(value);
    return d ? formatDate(d, { month: "short", day: "numeric", year: "numeric" }) : null;
  };

  const header = <FlowHeader variant="bar" title={t("sm.proj_title")} fallback="/site-manager" />;
  const shownError = describeLoadError(error, isOnline);

  if (loading && !project) {
    return <Screen header={header}><View style={styles.pad}><StateCard kind="loading" title={t("common.loading")} /></View></Screen>;
  }
  if (shownError && !project) {
    return <Screen header={header}><View style={styles.pad}><StateCard kind="error" title={t("sm.proj_err_load")} body={shownError} onRetry={() => load()} /></View></Screen>;
  }
  if (!project) {
    return <Screen header={header}><View style={styles.pad}><StateCard kind="empty" title={t("sm.proj_missing_title")} body={t("sm.proj_missing_body")} /></View></Screen>;
  }

  const progress = Math.max(0, Math.min(100, Math.round(Number(project.progress ?? 0)) || 0));
  const finished = project.status === "Completed";
  const health: { label: string; tone: ChipTone } | null = finished
    ? null
    : overdue > 0
      ? { label: t("common.at_risk"), tone: "amber" }
      : project.status === "Active"
        ? { label: t("common.on_track"), tone: "success" }
        : null;

  // "Banilad, Cebu City" + municipality "Cebu City" would otherwise print the city twice.
  const address = project.siteaddress?.trim() ?? "";
  const location = [address, project.municipality, project.province]
    .filter((part, i): part is string => !!part && (i === 0 || !address.toLowerCase().includes(part.toLowerCase())))
    .join(", ");
  const left = daysUntil(project.enddate);
  const scheduleText =
    finished || left === null
      ? null
      : left < 0
        ? t("sm.proj_days_over", { count: -left })
        : left === 0
          ? t("sm.proj_ends_today")
          : t("sm.proj_days_left", { count: left });

  const details: { key: string; label: string; value: string | null }[] = [
    { key: "loc", label: t("sm.proj_location"), value: location || null },
    { key: "client", label: t("sm.proj_client"), value: project.clientname || null },
    { key: "pm", label: t("sm.proj_pm"), value: project.projectmanagername || null },
    { key: "type", label: t("sm.proj_type"), value: project.projecttype || null },
    { key: "start", label: t("sm.proj_start"), value: day(project.startdate) },
    { key: "cstart", label: t("sm.proj_construction_start"), value: day(project.constructionstartdate) },
    { key: "end", label: t("sm.proj_end"), value: day(project.enddate) },
    { key: "actual", label: t("sm.proj_completed_on"), value: day(project.actualcompletiondate) },
  ].filter((row) => row.value);

  const shownTasks = showAll ? open : open.slice(0, TASKS_SHOWN);

  const footer = (
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <AppButton
        label={t("mobile.request_ticket")}
        accessibilityLabel={t("mobile.request_ticket_accessibility")}
        onPress={() => router.push({ pathname: "/ticket-request", params: { projectId: project.projectid } } as Href)}
        style={styles.footerPrimary}
      />
      <AppButton
        label={t("sm.proj_checkin")}
        variant="secondary"
        onPress={() => router.push("/site-manager/checkin" as Href)}
        style={styles.footerSecondary}
      />
    </View>
  );

  return (
    <Screen header={header} footer={footer}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
      >
        {savedAt ? <Text style={styles.savedNote}>{t("sm.proj_saved_copy", { when: savedAtLabel(savedAt, new Date(), t, intlLocale) })}</Text> : null}

        {/* Overview */}
        <Text style={styles.name}>{project.name}</Text>
        <View style={styles.chips}>
          <StatusChip label={tv("status", project.status)} tone={STATUS_TONE[project.status] ?? "neutral"} />
          {health ? <StatusChip label={health.label} tone={health.tone} /> : null}
        </View>
        {project.description ? <Text style={styles.description}>{project.description}</Text> : null}

        {/* Progress */}
        <View style={styles.progressBlock}>
          <View style={styles.progressTop}>
            <Text style={styles.sectionLabel}>{t("sm.proj_progress")}</Text>
            <Text style={styles.progressPct}>{progress}%</Text>
          </View>
          <View style={styles.track}><View style={[styles.fill, { width: `${progress}%` }]} /></View>
          {scheduleText ? <Text style={styles.schedule}>{scheduleText}</Text> : null}
          <View style={styles.stats}>
            <Stat value={open.length} label={t("sm.proj_open")} />
            <View style={styles.statDivider} />
            <Stat value={done} label={t("sm.proj_done")} />
            <View style={styles.statDivider} />
            <Stat value={overdue} label={t("sm.proj_overdue")} danger={overdue > 0} />
          </View>
        </View>

        {/* Details */}
        <Text style={styles.sectionTitle}>{t("sm.proj_details")}</Text>
        <View style={styles.list}>
          {details.map((row, i) => (
            <View key={row.key} style={[styles.row, i > 0 && styles.rowLine]}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={styles.rowValue}>{row.value}</Text>
            </View>
          ))}
        </View>

        {/* Tasks */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitleInline}>{t("sm.proj_tasks")}</Text>
          {open.length > TASKS_SHOWN ? (
            <Pressable onPress={() => setShowAll((v) => !v)} hitSlop={8} style={styles.linkHit}>
              <Text style={styles.link}>{showAll ? t("common.show_less") : t("sm.proj_view_all", { count: open.length })}</Text>
            </Pressable>
          ) : null}
        </View>
        {open.length === 0 ? (
          <Text style={styles.emptyTasks}>{tasks.length === 0 ? t("sm.proj_no_tasks") : t("sm.proj_all_done")}</Text>
        ) : (
          <View style={styles.list}>
            {shownTasks.map((task, i) => {
              const due = dueLabel(task.duedate, new Date(), t);
              return (
                <Pressable
                  key={task.taskid}
                  onPress={() => router.push(`/site-manager/task/${task.taskid}` as Href)}
                  style={({ pressed }) => [styles.taskRow, i > 0 && styles.rowLine, pressed && { backgroundColor: COLORS.bg }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${task.taskname}, ${due.text}`}
                >
                  <View style={styles.taskText}>
                    <Text style={styles.taskName} numberOfLines={2}>{task.taskname}</Text>
                    <Text style={styles.taskMeta} numberOfLines={1}>
                      {task.milestonename ? `${task.milestonename} · ` : ""}
                      <Text style={{ color: DUE_COLOR[due.tone as keyof typeof DUE_COLOR] }}>{due.text}</Text>
                    </Text>
                  </View>
                  <IconSymbol name="chevron.right" size={16} color={COLORS.muted} />
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function Stat({ value, label, danger }: { value: number; label: string; danger?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, danger && { color: COLORS.errorText }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 20 },
  content: { paddingBottom: 24, paddingHorizontal: 20, paddingTop: 16 },
  savedNote: { backgroundColor: COLORS.amberBannerFill, borderRadius: 10, color: COLORS.amberBannerText, fontFamily: FONT.medium, fontSize: 13, lineHeight: 18, marginBottom: 12, padding: 10 },

  name: { color: COLORS.heading, fontFamily: FONT.extrabold, fontSize: 25, letterSpacing: -0.4, lineHeight: 31 },
  chips: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  description: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 15, lineHeight: 22, marginTop: 12 },

  progressBlock: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderRadius: 16, borderWidth: 1, marginTop: 18, padding: 16 },
  progressTop: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between" },
  sectionLabel: { color: COLORS.muted, fontFamily: FONT.semibold, fontSize: 13 },
  progressPct: { color: COLORS.heading, fontFamily: FONT.extrabold, fontSize: 26 },
  track: { backgroundColor: COLORS.border, borderRadius: 4, height: 8, marginTop: 8, overflow: "hidden" },
  fill: { backgroundColor: COLORS.primary, borderRadius: 4, height: 8 },
  schedule: { color: COLORS.muted, fontFamily: FONT.medium, fontSize: 13, marginTop: 10 },
  stats: { alignItems: "center", borderTopColor: COLORS.border, borderTopWidth: 1, flexDirection: "row", marginTop: 14, paddingTop: 14 },
  stat: { alignItems: "center", flex: 1 },
  statValue: { color: COLORS.heading, fontFamily: FONT.extrabold, fontSize: 22 },
  statLabel: { color: COLORS.muted, fontFamily: FONT.medium, fontSize: 12, marginTop: 2 },
  statDivider: { backgroundColor: COLORS.border, height: 28, width: 1 },

  sectionTitle: { color: COLORS.heading, fontFamily: FONT.extrabold, fontSize: 17, marginBottom: 10, marginTop: 26 },
  sectionHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10, marginTop: 26 },
  sectionTitleInline: { color: COLORS.heading, fontFamily: FONT.extrabold, fontSize: 17 },
  linkHit: { justifyContent: "center", minHeight: 32 },
  link: { color: COLORS.primary, fontFamily: FONT.bold, fontSize: 14 },

  list: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  row: { alignItems: "flex-start", flexDirection: "row", gap: 16, justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 13 },
  rowLine: { borderTopColor: COLORS.border, borderTopWidth: 1 },
  rowLabel: { color: COLORS.muted, flexShrink: 0, fontFamily: FONT.medium, fontSize: 14, width: 128 },
  rowValue: { color: COLORS.heading, flex: 1, fontFamily: FONT.semibold, fontSize: 15, lineHeight: 21, textAlign: "right" },

  taskRow: { alignItems: "center", flexDirection: "row", gap: 10, minHeight: MIN_TAP + 12, paddingHorizontal: 16, paddingVertical: 12 },
  taskText: { flex: 1 },
  taskName: { color: COLORS.heading, fontFamily: FONT.bold, fontSize: 15, lineHeight: 20 },
  taskMeta: { color: COLORS.muted, fontFamily: FONT.medium, fontSize: 13, marginTop: 3 },
  emptyTasks: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderRadius: 16, borderWidth: 1, color: COLORS.muted, fontFamily: FONT.regular, fontSize: 14, lineHeight: 20, padding: 16 },

  footer: { backgroundColor: COLORS.bg, borderTopColor: COLORS.border, borderTopWidth: 1, flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 12 },
  footerPrimary: { flex: 1.25 },
  footerSecondary: { flex: 1 },
});
