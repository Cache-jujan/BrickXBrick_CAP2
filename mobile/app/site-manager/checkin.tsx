import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { Redirect, Stack, router, useFocusEffect, type Href } from "expo-router";

import { AppButton } from "@/components/app-button";
import { BlockedReasons, fieldErrorStyle } from "@/components/blocked-reasons";
import { FlowHeader } from "@/components/flow-header";
import { KeyboardScreen } from "@/components/screen";
import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { type AssignedTask, type CheckinSlotName, type CheckinsToday } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { loadAssignedTasks, loadCheckinsToday } from "@/lib/cached-api";
import { useOnNewNotifications } from "@/lib/notification-events";
import {
  MAX_PHOTOS,
  SITE_STATUSES,
  SLOTS,
  SLOT_LABEL,
  checkinProblems,
  manilaDate,
  slotStates,
} from "@/lib/sync/checkin";
import {
  dismissRejectedCheckin,
  getPendingCheckinSlots,
  getRejectedCheckins,
  queueCheckin,
} from "@/lib/sync/db";
import { describeCheckinRejection, describeLoadError, plainError } from "@/lib/sync/messages";
import { useNetwork } from "@/lib/sync/network-context";
import { savedAtLabel } from "@/lib/sync/offline-cache";
import { useLocale } from "@/lib/i18n-context";
import { copyPhotoToQueue, deleteQueuedPhoto } from "@/lib/sync/task-photo";

// A row of offline_checkins that the server refused (lib/sync/db.js).
type RejectedCheckin = {
  client_id: string;
  project_id: string;
  slot: string;
  checkin_date: string;
  error_code: string | null;
  error_message: string | null;
};

const STATE_TEXT: Record<string, string> = {
  Submitted: "Sent",
  Queued: "Saved on this phone",
  Open: "Open now",
  Upcoming: "Not open yet",
  Missed: "Window passed",
};

const STATUS_HELP: Record<string, string> = {
  "On Track": "Work is going as planned.",
  Delayed: "Behind schedule, but moving.",
  Blocked: "Work cannot continue.",
};

export default function SiteManagerCheckinScreen() {
  const { t, intlLocale } = useLocale();
  const session = getSession();
  const { isOnline, refreshPendingCount, syncNow, pendingCount, lastSync } = useNetwork();

  const [today, setToday] = useState<CheckinsToday | null>(null);
  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingSlots, setPendingSlots] = useState<{ client_id: string; project_id: string; slot: string }[]>([]);
  const [rejected, setRejected] = useState<RejectedCheckin[]>([]);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [slot, setSlot] = useState<CheckinSlotName | null>(null);
  const [siteStatus, setSiteStatus] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [issues, setIssues] = useState("");
  const [needsPmAction, setNeedsPmAction] = useState(false);
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const slotChosenRef = useRef(false);
  const todayRef = useRef<CheckinsToday | null>(null);
  const onlineRef = useRef(isOnline);
  onlineRef.current = isOnline;

  const readLocal = useCallback(() => {
    const user = getSession()?.user.id;
    if (!user) return;
    setPendingSlots(getPendingCheckinSlots(user, manilaDate()) as { client_id: string; project_id: string; slot: string }[]);
    setRejected((getRejectedCheckins(user) as RejectedCheckin[]) ?? []);
  }, []);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setLoadError(null);
      try {
        const result = await loadCheckinsToday();
        setSavedAt(result.fromCache ? result.savedAt : null);
        todayRef.current = result.data;
        setToday(result.data);
        setProjectId((current) => current ?? (result.data.projects.length === 1 ? result.data.projects[0].projectId : null));
        if (!slotChosenRef.current) setSlot(result.data.suggestedSlot);
        // The tasks are optional: a failure here must not block the check-in.
        loadAssignedTasks()
          .then((r) => setTasks(r.data))
          .catch(() => {});
      } catch (err) {
        if (!todayRef.current) {
          setLoadError(
            onlineRef.current
              ? describeLoadError(err, true) ?? "Unable to load your check-ins."
              : "You're offline, and your projects haven't been saved on this phone yet. Open the app once with a connection; after that you can write check-ins offline."
          );
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
      readLocal();
    },
    [readLocal]
  );

  useFocusEffect(
    useCallback(() => {
      if (session?.user.role === "Site Manager") load();
    }, [load, session?.user.role])
  );
  // A sync just finished (or the queue changed): re-read, so "Saved on this phone" turns into "Sent".
  useEffect(() => {
    readLocal();
    if (isOnline && session?.user.role === "Site Manager") load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCount, lastSync]);
  useOnNewNotifications(() => {
    load(true);
  });

  const project = today?.projects.find((p) => p.projectId === projectId) ?? null;
  const slots = useMemo(
    () => (project ? slotStates(project.slots, pendingSlots, project.projectId) : []),
    [project, pendingSlots]
  );
  const chosen = slots.find((s) => s.slot === slot) ?? null;
  const slotTaken = !!chosen && (chosen.state === "Submitted" || chosen.state === "Queued");
  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectid === projectId && t.status !== "Completed"),
    [tasks, projectId]
  );

  if (!session || session.user.role !== "Site Manager") return <Redirect href="/login" />;

  const problems = checkinProblems({
    projectId,
    slot,
    siteStatus,
    summary,
    issues,
    needsPmAction,
    taskIds,
    photoCount: photos.length,
  });
  const blocked = [...problems, slotTaken ? `${chosen ? SLOT_LABEL[chosen.slot] : "This"} check-in is already ${chosen?.state === "Queued" ? "saved on this phone" : "sent"} for today.` : ""];

  async function addPhoto() {
    if (photos.length >= MAX_PHOTOS) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Camera access needed", "Enable camera access in your phone settings to add site photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (!result.canceled) setPhotos((current) => [...current, result.assets[0]].slice(0, MAX_PHOTOS));
  }

  function toggleTask(id: string) {
    setTaskIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  // Always save on the phone first, then send. One path whether or not there is
  // a connection: the saved copy keeps its id, so a send that fails halfway can
  // be repeated without ever creating a second check-in.
  async function handleSave() {
    if (!session) return;
    setTriedSubmit(true);
    if (blocked.some(Boolean)) return;
    setSaving(true);
    setSaveError(null);
    const copied: string[] = [];
    try {
      for (const photo of photos) copied.push(await copyPhotoToQueue(photo.uri));
      const now = new Date();
      const result = queueCheckin({
        clientId: Crypto.randomUUID(),
        userId: session.user.id,
        projectId: projectId as string,
        checkinDate: manilaDate(now),
        slot: slot as string,
        capturedAt: now.toISOString(),
        siteStatus: siteStatus as string,
        summary: summary.trim(),
        issues: issues.trim() || null,
        needsPmAction,
        taskIds,
        photoPaths: copied,
      });
      if (!result.queued) {
        for (const path of copied) await deleteQueuedPhoto(path);
        setSaveError(result.message ?? "Could not save this check-in. Reconnect and try again.");
        return;
      }
      for (const path of result.replacedPhotoPaths ?? []) await deleteQueuedPhoto(path);
      refreshPendingCount();
      readLocal();
      setSummary("");
      setIssues("");
      setNeedsPmAction(false);
      setTaskIds([]);
      setPhotos([]);
      setSiteStatus(null);
      setTriedSubmit(false);
      slotChosenRef.current = false;
      if (isOnline) {
        syncNow();
        Alert.alert("Check-in saved", "It is being sent to your Project Manager now.", [{ text: "OK", onPress: goBack }]);
      } else {
        Alert.alert("Saved on your phone", "It will be sent automatically when you're back online.", [{ text: "OK", onPress: goBack }]);
      }
    } catch (err) {
      for (const path of copied) await deleteQueuedPhoto(path);
      setSaveError(plainError(err, "Unable to save this check-in."));
    } finally {
      setSaving(false);
    }
  }

  function goBack() {
    router.replace("/site-manager");
  }

  async function dismiss(row: RejectedCheckin) {
    for (const path of dismissRejectedCheckin(row.client_id) as string[]) await deleteQueuedPhoto(path);
    readLocal();
  }

  const projectName = (id: string) => today?.projects.find((p) => p.projectId === id)?.name ?? "a project";

  return (
    <KeyboardScreen
      background={COLORS.bgWarm}
      header={<FlowHeader variant="bar" title="Progress check-in" fallback="/site-manager" />}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
    >
      <Stack.Screen options={{ headerShown: false }} />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={styles.muted}>Loading…</Text>
        </View>
      ) : loadError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Couldn’t load check-ins</Text>
          <Text style={styles.errorBody}>{loadError}</Text>
          <AppButton label="Try again" variant="secondary" onPress={() => load()} />
        </View>
      ) : today && today.projects.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No active project</Text>
          <Text style={styles.muted}>Check-ins are made for an Active project you run. None is active right now.</Text>
        </View>
      ) : today ? (
        <>
          {savedAt && (
            <Text style={styles.savedNote}>
              {isOnline ? "Can't reach the server" : "You're offline"} · showing projects {savedAtLabel(savedAt, new Date(), t, intlLocale)}.
            </Text>
          )}
          <Text style={styles.eyebrow}>THREE TIMES A DAY</Text>
          <Text style={styles.title}>How is the site right now?</Text>
          <Text style={styles.muted}>
            A check-in is a report on the project. It does not change any task or progress.
          </Text>

          {rejected.map((row) => (
            <View key={row.client_id} style={styles.errorCard}>
              <Text style={styles.errorTitle}>
                {SLOT_LABEL[row.slot as CheckinSlotName] ?? row.slot} check-in not sent
              </Text>
              <Text style={styles.errorBody}>
                {projectName(row.project_id)} · {row.checkin_date}
                {"\n"}
                {describeCheckinRejection(row.error_code ?? "", row.error_message ?? "")}
              </Text>
              <AppButton label="OK" variant="secondary" fit onPress={() => dismiss(row)} />
            </View>
          ))}

          <Text style={styles.label}>{today.projects.length === 1 ? "Checking in for" : "Project"}</Text>
          {today.projects.length === 1 && (
            <View style={styles.projectCard}>
              <Text style={styles.projectName}>{today.projects[0].name}</Text>
              <Text style={styles.hint}>This is your only active project.</Text>
            </View>
          )}
          <View style={[styles.chipRow, today.projects.length === 1 && { display: "none" }]}>
            {today.projects.map((p) => (
              <Pressable
                key={p.projectId}
                onPress={() => setProjectId(p.projectId)}
                style={[styles.chip, projectId === p.projectId && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: projectId === p.projectId }}
              >
                <Text style={[styles.chipText, projectId === p.projectId && styles.chipTextOn]}>{p.name}</Text>
              </Pressable>
            ))}
          </View>
          {today.projects.length > 1 && (
            <Text style={projectId ? styles.hint : styles.fieldError}>
              {projectId ? `Checking in for ${project?.name ?? ""}.` : "Choose which project this check-in is for."}
            </Text>
          )}

          {project && (
            <>
              <Text style={styles.label}>Which check-in</Text>
              <View style={styles.slotRow}>
                {slots.map((s) => {
                  const on = slot === s.slot;
                  const done = s.state === "Submitted" || s.state === "Queued";
                  return (
                    <Pressable
                      key={s.slot}
                      onPress={() => {
                        // A slot already sent (or saved on this phone) opens what was sent.
                        const sentId =
                          s.state === "Queued"
                            ? pendingSlots.find((p) => p.project_id === project.projectId && p.slot === s.slot)?.client_id
                            : s.state === "Submitted"
                              ? s.checkinId
                              : null;
                        if (sentId) {
                          router.push(`/site-manager/checkin/${sentId}` as Href);
                          return;
                        }
                        slotChosenRef.current = true;
                        setSlot(s.slot);
                      }}
                      style={[styles.slotBox, on && styles.chipOn, done && styles.slotDone]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.slotName, on && styles.chipTextOn]}>{SLOT_LABEL[s.slot]}</Text>
                      <Text style={[styles.slotWindow, on && styles.chipTextOn]}>{s.window}</Text>
                      <Text style={[styles.slotState, on && styles.chipTextOn, done && !on && { color: COLORS.success }]}>
                        {STATE_TEXT[s.state] ?? s.state}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.hint}>Times are Philippine time. A check-in outside its window is still accepted.</Text>

              <Text style={styles.label}>Site status</Text>
              <View style={styles.chipRow}>
                {SITE_STATUSES.map((status) => (
                  <Pressable
                    key={status}
                    onPress={() => setSiteStatus(status)}
                    style={[styles.chip, siteStatus === status && styles.chipOn, triedSubmit && !siteStatus && fieldErrorStyle]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: siteStatus === status }}
                  >
                    <Text style={[styles.chipText, siteStatus === status && styles.chipTextOn]}>{status}</Text>
                  </Pressable>
                ))}
              </View>
              {siteStatus && <Text style={styles.hint}>{STATUS_HELP[siteStatus]}</Text>}

              <Text style={styles.label}>Summary</Text>
              <TextInput
                value={summary}
                onChangeText={setSummary}
                placeholder="What is happening on site? Work done, crew, deliveries."
                placeholderTextColor={COLORS.muted}
                multiline
                maxLength={2000}
                style={[styles.input, styles.multiline, triedSubmit && !summary.trim() && fieldErrorStyle]}
              />

              <Text style={styles.label}>Issues (optional)</Text>
              <TextInput
                value={issues}
                onChangeText={setIssues}
                placeholder="Anything slowing the work down?"
                placeholderTextColor={COLORS.muted}
                multiline
                maxLength={2000}
                style={[styles.input, styles.multiline, triedSubmit && needsPmAction && !issues.trim() && fieldErrorStyle]}
              />
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchTitle}>Needs my Project Manager to act</Text>
                  <Text style={styles.hint}>Your Project Manager is notified right away.</Text>
                </View>
                <Switch
                  value={needsPmAction}
                  onValueChange={setNeedsPmAction}
                  trackColor={{ true: COLORS.primary }}
                  accessibilityLabel="Needs Project Manager action"
                />
              </View>

              {projectTasks.length > 0 && (
                <>
                  <Text style={styles.label}>Tasks this is about (optional)</Text>
                  <View style={styles.chipRow}>
                    {projectTasks.map((t) => {
                      const on = taskIds.includes(t.taskid);
                      return (
                        <Pressable
                          key={t.taskid}
                          onPress={() => toggleTask(t.taskid)}
                          style={[styles.chip, on && styles.chipOn]}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                        >
                          <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                            {t.taskname}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.hint}>Linking a task only points to it. It does not update the task.</Text>
                </>
              )}

              <Text style={styles.label}>
                Photos (optional, up to {MAX_PHOTOS})
              </Text>
              <View style={styles.photoRow}>
                {photos.map((photo, index) => (
                  <View key={photo.uri} style={styles.photoBox}>
                    <Image source={{ uri: photo.uri }} style={styles.photo} />
                    <Pressable
                      onPress={() => setPhotos((current) => current.filter((_, i) => i !== index))}
                      style={styles.photoRemove}
                      accessibilityLabel="Remove photo"
                    >
                      <Text style={styles.photoRemoveText}>×</Text>
                    </Pressable>
                  </View>
                ))}
                {photos.length < MAX_PHOTOS && (
                  <Pressable onPress={addPhoto} style={[styles.photoBox, styles.photoAdd]} accessibilityLabel="Add photo">
                    <Text style={styles.photoAddText}>＋{"\n"}Photo</Text>
                  </Pressable>
                )}
              </View>

              {triedSubmit && <BlockedReasons reasons={blocked} />}
              {saveError && <Text style={styles.fieldError}>{saveError}</Text>}
              <AppButton
                label={isOnline ? "Send check-in" : "Save check-in on phone"}
                variant="primary"
                loading={saving}
                disabled={saving}
                onPress={handleSave}
              />
              {!isOnline && <Text style={styles.hint}>You're offline. It will be sent automatically when you reconnect.</Text>}
            </>
          )}

          <Pressable onPress={() => router.replace("/site-manager")} style={styles.back} accessibilityRole="button">
            <Text style={styles.backText}>Back to my tasks</Text>
          </Pressable>
        </>
      ) : null}
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, gap: 8 },
  center: { alignItems: "center", gap: 8, paddingVertical: 48 },
  eyebrow: { color: COLORS.primary, fontFamily: FONT.extrabold, fontSize: 12, letterSpacing: 1 },
  title: { color: COLORS.heading, fontFamily: FONT.extrabold, fontSize: 24 },
  muted: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 14 },
  hint: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 12 },
  projectCard: { backgroundColor: COLORS.primaryTint, borderColor: COLORS.primary, borderWidth: 1, borderRadius: 12, padding: 12, gap: 2 },
  projectName: { color: COLORS.primaryTintText, fontFamily: FONT.extrabold, fontSize: 16 },
  savedNote: { color: COLORS.amberBannerText, backgroundColor: COLORS.amberBannerFill, padding: 8, borderRadius: 8, fontFamily: FONT.medium, fontSize: 12 },
  label: { color: COLORS.heading, fontFamily: FONT.bold, fontSize: 14, marginTop: 12 },
  card: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 14, padding: 16, gap: 6 },
  cardTitle: { color: COLORS.heading, fontFamily: FONT.bold, fontSize: 16 },
  errorCard: { backgroundColor: COLORS.errorFill, borderColor: COLORS.errorBorder, borderWidth: 1, borderRadius: 12, padding: 12, gap: 6, marginTop: 8 },
  errorTitle: { color: COLORS.errorText, fontFamily: FONT.extrabold, fontSize: 14 },
  errorBody: { color: COLORS.errorText, fontFamily: FONT.regular, fontSize: 13 },
  fieldError: { color: COLORS.errorText, fontFamily: FONT.medium, fontSize: 13 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: MIN_TAP, paddingHorizontal: 14, justifyContent: "center", borderRadius: 22, borderWidth: 1, borderColor: COLORS.inputBorder, backgroundColor: COLORS.card, maxWidth: "100%" },
  chipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.heading, fontFamily: FONT.semibold, fontSize: 14 },
  chipTextOn: { color: "#FFFFFF" },
  slotRow: { flexDirection: "row", gap: 8 },
  slotBox: { flex: 1, minHeight: MIN_TAP, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: COLORS.inputBorder, backgroundColor: COLORS.card, gap: 2 },
  slotDone: { backgroundColor: COLORS.successBg, borderColor: COLORS.success },
  slotName: { color: COLORS.heading, fontFamily: FONT.bold, fontSize: 14 },
  slotWindow: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 11 },
  slotState: { color: COLORS.muted, fontFamily: FONT.semibold, fontSize: 11 },
  input: { backgroundColor: COLORS.card, borderColor: COLORS.inputBorder, borderWidth: 1, borderRadius: 12, padding: 12, color: COLORS.heading, fontFamily: FONT.regular, fontSize: 15 },
  multiline: { minHeight: 96, textAlignVertical: "top" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8, minHeight: MIN_TAP },
  switchTitle: { color: COLORS.heading, fontFamily: FONT.semibold, fontSize: 14 },
  photoRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  photoBox: { width: 96, height: 96, borderRadius: 12, overflow: "hidden" },
  photo: { width: 96, height: 96 },
  photoAdd: { borderWidth: 1.5, borderStyle: "dashed", borderColor: COLORS.primary, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.primaryTint },
  photoAddText: { color: COLORS.primaryTintText, fontFamily: FONT.bold, fontSize: 13, textAlign: "center" },
  photoRemove: { position: "absolute", top: 4, right: 4, width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  photoRemoveText: { color: "#FFFFFF", fontSize: 18, lineHeight: 20 },
  back: { minHeight: MIN_TAP, alignItems: "center", justifyContent: "center", marginTop: 12 },
  backText: { color: COLORS.primary, fontFamily: FONT.bold, fontSize: 14 },
});