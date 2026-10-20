import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { Redirect, Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { COLORS } from "@/constants/expense-flow-colors";
import { fetchAssignedTasks, submitTaskProgress, type AssignedTask } from "@/lib/api";
import { getSession } from "@/lib/auth";
import {
  dismissRejectedTaskUpdate,
  getPendingTaskUpdateForTask,
  getRejectedTaskUpdates,
  queueTaskUpdate,
} from "@/lib/sync/db";
import { describeRejection } from "@/lib/sync/messages";
import { useNetwork } from "@/lib/sync/network-context";
import { copyPhotoToQueue, deleteQueuedPhoto } from "@/lib/sync/task-photo";

// A row of offline_task_updates (lib/sync/db.js).
type QueuedUpdate = {
  update_id: string;
  task_id: string;
  photo_path: string;
  note: string | null;
  error_code: string | null;
  error_message: string | null;
};

export default function SiteManagerTaskDetailScreen() {
  const session = getSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [task, setTask] = useState<AssignedTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [note, setNote] = useState("");
  const [clientSubmissionId, setClientSubmissionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // F10 — offline queue state for THIS task.
  const { isOnline, pendingCount, refreshPendingCount } = useNetwork();
  const [queued, setQueued] = useState<QueuedUpdate | null>(null);
  const [rejectedHere, setRejectedHere] = useState<QueuedUpdate[]>([]);
  const [savedOffline, setSavedOffline] = useState(false);
  const taskRef = useRef<AssignedTask | null>(null);
  const hadQueuedRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  // How many tasks in this task's project are still unfinished for this SM.
  const [projectPending, setProjectPending] = useState<number | null>(null);

  const loadLocal = useCallback(() => {
    setQueued((getPendingTaskUpdateForTask(id) as QueuedUpdate | null) ?? null);
    setRejectedHere((getRejectedTaskUpdates() as QueuedUpdate[]).filter((row) => row.task_id === id));
  }, [id]);

  const loadTask = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const assignedTasks = await fetchAssignedTasks();
      const matchingTask = assignedTasks.find((item) => item.taskid === id);
      if (!matchingTask) {
        throw new Error("This task is no longer assigned to your account.");
      }
      taskRef.current = matchingTask;
      setTask(matchingTask);
      setProjectPending(
        assignedTasks.filter(
          (item) => item.projectname === matchingTask.projectname && item.status !== "Completed"
        ).length
      );
    } catch (err) {
      // Offline refresh: keep showing the task that is already on screen, so the
      // form (and "Queue Update") stays usable. Only a first load shows the error.
      if (!taskRef.current) setError(err instanceof Error ? err.message : "Unable to load this task.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      loadLocal();
      if (session?.user.role === "Site Manager") loadTask();
    }, [loadLocal, loadTask, session?.user.role])
  );

  // The queue changed (an entry was added, or a sync finished): re-read it. When
  // this task's queued update has just been sent, reload the task so the
  // evidence photo and status show what the server now has.
  useEffect(() => {
    const row = getPendingTaskUpdateForTask(id);
    loadLocal();
    if (hadQueuedRef.current && !row && isOnline) loadTask(true);
    hadQueuedRef.current = !!row;
  }, [pendingCount, id, isOnline, loadLocal, loadTask]);

  if (!session || session.user.role !== "Site Manager") return <Redirect href="/login" />;

  const evidenceUrl = task?.pendingphotoevidenceurl || task?.photoevidenceurl;
  // D-04: flag only ever lived on the log row — the SM had no way to see
  // that a submission was flagged, let alone why, short of asking the PM.
  const flagged = task?.latestreviewstatus === "Flagged";

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Camera access needed", "Enable camera access in your phone settings to add task evidence.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (!result.canceled) {
      setPhoto(result.assets[0]);
      setClientSubmissionId(null);
      setSubmitted(false);
      setSavedOffline(false);
      setSubmitError(null);
    }
  }

  // F10 — no connection: keep the photo on the phone and queue the update. It is
  // sent by itself on reconnect (lib/sync/sync.js). One queued update per task:
  // a newer one replaces the older one.
  async function queueOffline() {
    if (!task || !photo || !session) return;
    setSubmitting(true);
    setSubmitError(null);
    let copiedPath: string | null = null;
    try {
      copiedPath = await copyPhotoToQueue(photo.uri);
      const result = queueTaskUpdate({
        updateId: Crypto.randomUUID(),
        taskId: task.taskid,
        userId: session.user.id,
        photoPath: copiedPath,
        note: note.trim(),
      });
      if (!result.queued) {
        await deleteQueuedPhoto(copiedPath);
        setSubmitError(result.message ?? "Could not save this update offline. Reconnect and try again.");
        return;
      }
      if (result.replacedPhotoPath) await deleteQueuedPhoto(result.replacedPhotoPath);
      refreshPendingCount();
      loadLocal();
      setPhoto(null);
      setNote("");
      setSavedOffline(true);
      Alert.alert("Saved on your phone", "It will be sent to your Project Manager automatically when you're back online.");
      router.replace("/site-manager");
    } catch (err) {
      if (copiedPath) await deleteQueuedPhoto(copiedPath);
      setSubmitError(err instanceof Error ? err.message : "Unable to save this update on your phone.");
    } finally {
      setSubmitting(false);
    }
  }

  async function dismissRejected(row: QueuedUpdate) {
    const path = dismissRejectedTaskUpdate(row.update_id);
    await deleteQueuedPhoto(path);
    loadLocal();
  }

  async function handleSubmit() {
    if (!task || !photo) {
      setSubmitError("Choose a photo before submitting progress.");
      return;
    }
    if (!isOnline) {
      await queueOffline();
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const submissionId = clientSubmissionId || Crypto.randomUUID();
      if (!clientSubmissionId) setClientSubmissionId(submissionId);

      await submitTaskProgress(task.taskid, photo, note, submissionId);
      // Clear the form so it doesn't look unsent, then go back to the task
      // list. The list reloads on focus and shows this task as awaiting review.
      setPhoto(null);
      setNote("");
      setClientSubmissionId(null);
      setSubmitted(false);
      Alert.alert("Submitted for review", "Your Project Manager can now review this progress update.");
      router.replace("/site-manager");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Unable to submit task progress.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Lifts the form above the keyboard so the Note box is never covered. */}
      <KeyboardAvoidingView style={styles.keyboardAvoider} behavior="padding">
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadTask(true)} />
        }
      >
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹ Back to tasks</Text>
        </Pressable>

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={styles.stateBody}>Loading task…</Text>
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Couldn’t load task</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Pressable onPress={() => loadTask()} style={styles.retryButton}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : task ? (
          <>
            <Text style={styles.eyebrow}>TASK DETAILS</Text>
            <Text style={styles.title}>{task.taskname}</Text>
            <View style={[styles.statusPill, task.status === "Completed" && styles.statusPillCompleted]}>
              <Text style={[styles.statusText, task.status === "Completed" && styles.statusTextCompleted]}>
                {task.status}
              </Text>
            </View>

            <View style={styles.progressCard}>
              <Text style={styles.cardLabel}>PROGRESS</Text>
              <Text style={styles.progressValue}>{Number(task.completionpercentage || 0)}%</Text>
              <Text style={styles.progressBody}>
                {task.status === "Completed"
                  ? "This task has been completed and acknowledged."
                  : "Add a photo and note when the work is ready for PM review."}
              </Text>
            </View>

            <View style={styles.infoCard}>
              {task.projectname && <InfoRow label="Project" value={task.projectname} />}
              {task.projectname && projectPending !== null && (
                <InfoRow
                  label="Pending in this project"
                  value={`${projectPending} task${projectPending === 1 ? "" : "s"}`}
                />
              )}
              {task.milestonename && <InfoRow label="Milestone" value={task.milestonename} />}
              <InfoRow label="Due date" value={formatDate(task.duedate)} />
              <InfoRow label="Task status" value={task.status} />
            </View>

            {flagged && (
              <View style={styles.flagCard}>
                <Text style={styles.flagTitle}>Flagged — resubmission needed</Text>
                {task.latestreviewreason && <Text style={styles.flagBody}>{task.latestreviewreason}</Text>}
              </View>
            )}

            {task.pendingphotoevidenceurl && task.status !== "Completed" && (
              <View style={styles.queuedCard}>
                <Text style={styles.queuedTitle}>Awaiting PM review</Text>
                <Text style={styles.queuedHint}>
                  Your latest update was sent. Submitting a new photo below replaces it.
                </Text>
              </View>
            )}

            {evidenceUrl && (
              <View style={styles.evidenceCard}>
                <Text style={styles.evidenceTitle}>
                  {task.pendingphotoevidenceurl ? "Latest submitted evidence" : "Submitted evidence"}
                </Text>
                <Image source={{ uri: evidenceUrl }} style={styles.evidenceImage} />
              </View>
            )}

            {rejectedHere.map((row) => (
              <View key={row.update_id} style={styles.flagCard}>
                <Text style={styles.flagTitle}>Update not sent</Text>
                <Text style={styles.flagBody}>{describeRejection(row.error_code ?? "", row.error_message ?? "")}</Text>
                <Pressable onPress={() => dismissRejected(row)} style={styles.dismissButton}>
                  <Text style={styles.dismissText}>Dismiss</Text>
                </Pressable>
              </View>
            ))}

            {queued && (
              <View style={styles.queuedCard}>
                <Text style={styles.queuedTitle}>Queued — will send when you're back online</Text>
                <Image source={{ uri: queued.photo_path }} style={styles.queuedImage} />
                {queued.note ? <Text style={styles.queuedNote}>{queued.note}</Text> : null}
                <Text style={styles.queuedHint}>Submitting another photo below replaces this queued update.</Text>
              </View>
            )}

            {task.status !== "Completed" && (
              <View style={styles.submissionSection}>
                <Text style={styles.sectionTitle}>Progress update</Text>
                <Text style={styles.sectionSubtitle}>Take one photo as evidence and add an optional note.</Text>

                <View style={styles.photoActions}>
                  <Pressable onPress={takePhoto} style={styles.photoButton}>
                    <Text style={styles.photoButtonIcon}>⌾</Text>
                    <Text style={styles.photoButtonText}>Take photo</Text>
                  </Pressable>
                </View>

                {photo ? (
                  <View style={styles.previewCard}>
                    <Image source={{ uri: photo.uri }} style={styles.previewImage} />
                    <View style={styles.previewFooter}>
                      <Text style={styles.previewName} numberOfLines={1}>
                        {photo.fileName || "Task evidence photo"}
                      </Text>
                      <Pressable onPress={() => { setPhoto(null); setClientSubmissionId(null); setSubmitted(false); setSubmitError(null); }}>
                        <Text style={styles.removeText}>Remove</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={styles.photoEmpty}>
                    <Text style={styles.photoEmptyTitle}>No evidence photo selected</Text>
                    <Text style={styles.photoEmptyBody}>JPEG or PNG photos will be accepted.</Text>
                  </View>
                )}

                <Text style={styles.noteLabel}>Note (optional)</Text>
                <TextInput
                  multiline
                  numberOfLines={4}
                  maxLength={500}
                  placeholder="Add context for your Project Manager"
                  placeholderTextColor={COLORS.muted}
                  style={styles.noteInput}
                  value={note}
                  onChangeText={setNote}
                  onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250)}
                  textAlignVertical="top"
                />

                {submitError && <Text style={styles.submitError}>{submitError}</Text>}
                {savedOffline && !photo ? (
                  <View style={styles.successCard}>
                    <Text style={styles.successTitle}>Saved on your phone</Text>
                    <Text style={styles.successBody}>
                      It will be sent to your Project Manager automatically when you're back online.
                    </Text>
                  </View>
                ) : null}
                {submitted ? (
                  <View style={styles.successCard}>
                    <Text style={styles.successTitle}>Submitted for review</Text>
                    <Text style={styles.successBody}>
                      Your Project Manager can now review this progress update.
                    </Text>
                    <Pressable onPress={() => router.replace("/site-manager")} style={styles.successBackButton}>
                      <Text style={styles.successBackText}>Back to my tasks</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    disabled={submitting}
                    onPress={handleSubmit}
                    style={({ pressed }) => [styles.submitButton, pressed && styles.submitButtonPressed, submitting && styles.submitButtonDisabled]}
                  >
                    {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.submitButtonText}>{isOnline ? "Submit for PM review" : "Queue Update"}</Text>}
                  </Pressable>
                )}
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#F8F1E8", flex: 1 },
  keyboardAvoider: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  backButton: { alignSelf: "flex-start", marginBottom: 30, paddingVertical: 6 },
  backText: { color: COLORS.primary, fontSize: 14, fontWeight: "800" },
  eyebrow: { color: COLORS.primary, fontSize: 11, fontWeight: "800", letterSpacing: 1.5, marginBottom: 8 },
  title: { color: COLORS.heading, fontSize: 28, fontWeight: "800", lineHeight: 34 },
  statusPill: { alignSelf: "flex-start", backgroundColor: "#FFF0E6", borderRadius: 20, marginTop: 14, paddingHorizontal: 11, paddingVertical: 6 },
  statusPillCompleted: { backgroundColor: COLORS.successBg },
  statusText: { color: COLORS.primary, fontSize: 12, fontWeight: "800" },
  statusTextCompleted: { color: COLORS.success },
  progressCard: { backgroundColor: "#1A1A1A", borderRadius: 18, marginTop: 28, padding: 20 },
  cardLabel: { color: "#D8C7AA", fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  progressValue: { color: "#FFFFFF", fontSize: 42, fontWeight: "800", marginTop: 10 },
  progressBody: { color: "#C9C0B3", fontSize: 13, lineHeight: 19, marginTop: 8 },
  infoCard: { backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 16, borderWidth: 1, marginTop: 14, paddingHorizontal: 16 },
  infoRow: { borderBottomColor: "#EEE7DE", borderBottomWidth: 1, paddingVertical: 15 },
  infoLabel: { color: COLORS.muted, fontSize: 12, fontWeight: "600" },
  infoValue: { color: COLORS.heading, fontSize: 14, fontWeight: "700", marginTop: 5 },
  flagCard: { backgroundColor: "#FFF5F3", borderColor: "#F4C7C3", borderRadius: 16, borderWidth: 1, marginTop: 14, padding: 16 },
  flagTitle: { color: "#B42318", fontSize: 14, fontWeight: "800" },
  flagBody: { color: "#8C2D24", fontSize: 13, lineHeight: 19, marginTop: 6 },
  evidenceCard: { backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 16, borderWidth: 1, marginTop: 14, overflow: "hidden", padding: 12 },
  evidenceTitle: { color: COLORS.heading, fontSize: 13, fontWeight: "800", marginBottom: 10 },
  evidenceImage: { backgroundColor: "#EEE7DE", borderRadius: 10, height: 220, width: "100%" },
  submissionSection: { marginTop: 26 },
  sectionTitle: { color: COLORS.heading, fontSize: 18, fontWeight: "800" },
  sectionSubtitle: { color: COLORS.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  photoActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  photoButton: { alignItems: "center", backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 14, borderWidth: 1, flex: 1, minHeight: 82, justifyContent: "center" },
  photoButtonIcon: { color: COLORS.primary, fontSize: 25, fontWeight: "700" },
  photoButtonText: { color: COLORS.heading, fontSize: 12, fontWeight: "800", marginTop: 7 },
  previewCard: { backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 16, borderWidth: 1, marginTop: 12, overflow: "hidden" },
  previewImage: { backgroundColor: "#EEE7DE", height: 190, width: "100%" },
  previewFooter: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", padding: 12 },
  previewName: { color: COLORS.heading, flex: 1, fontSize: 12, fontWeight: "700", marginRight: 10 },
  removeText: { color: "#B42318", fontSize: 12, fontWeight: "800" },
  photoEmpty: { alignItems: "center", backgroundColor: "#FFFCF8", borderColor: "#E7DDCF", borderRadius: 14, borderStyle: "dashed", borderWidth: 1, marginTop: 12, padding: 22 },
  photoEmptyTitle: { color: COLORS.heading, fontSize: 13, fontWeight: "800" },
  photoEmptyBody: { color: COLORS.muted, fontSize: 12, marginTop: 6 },
  noteLabel: { color: COLORS.heading, fontSize: 13, fontWeight: "800", marginBottom: 7, marginTop: 18 },
  noteInput: { backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 13, borderWidth: 1, color: COLORS.heading, fontSize: 14, minHeight: 100, padding: 13 },
  submitError: { color: "#B42318", fontSize: 13, lineHeight: 19, marginTop: 12 },
  submitButton: { alignItems: "center", backgroundColor: COLORS.primary, borderRadius: 14, justifyContent: "center", marginTop: 14, minHeight: 50, paddingHorizontal: 16 },
  submitButtonPressed: { opacity: 0.82 },
  submitButtonDisabled: { opacity: 0.65 },
  submitButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  successCard: { backgroundColor: COLORS.successBg, borderColor: "#B7E2C0", borderRadius: 16, borderWidth: 1, marginTop: 14, padding: 16 },
  successTitle: { color: "#166534", fontSize: 15, fontWeight: "800" },
  successBody: { color: "#287443", fontSize: 13, lineHeight: 19, marginTop: 6 },
  successBackButton: { alignSelf: "flex-start", borderColor: "#287443", borderRadius: 10, borderWidth: 1, marginTop: 14, paddingHorizontal: 13, paddingVertical: 9 },
  successBackText: { color: "#166534", fontSize: 12, fontWeight: "800" },
  queuedCard: { backgroundColor: "#FFF8E6", borderColor: "#F0D78C", borderRadius: 16, borderWidth: 1, marginTop: 14, padding: 14 },
  queuedTitle: { color: "#8A5A00", fontSize: 14, fontWeight: "800" },
  queuedImage: { backgroundColor: "#EEE7DE", borderRadius: 10, height: 160, marginTop: 10, width: "100%" },
  queuedNote: { color: COLORS.heading, fontSize: 13, lineHeight: 19, marginTop: 10 },
  queuedHint: { color: COLORS.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  dismissButton: { alignSelf: "flex-start", borderColor: "#B42318", borderRadius: 10, borderWidth: 1, marginTop: 12, paddingHorizontal: 13, paddingVertical: 8 },
  dismissText: { color: "#B42318", fontSize: 12, fontWeight: "800" },
  centerState: { alignItems: "center", paddingVertical: 80 },
  stateBody: { color: COLORS.muted, fontSize: 13, marginTop: 10 },
  errorCard: { backgroundColor: "#FFF5F3", borderColor: "#F4C7C3", borderRadius: 16, borderWidth: 1, padding: 16 },
  errorTitle: { color: "#B42318", fontSize: 15, fontWeight: "800" },
  errorBody: { color: "#8C2D24", fontSize: 13, lineHeight: 19, marginTop: 6 },
  retryButton: { alignSelf: "flex-start", backgroundColor: COLORS.primary, borderRadius: 10, marginTop: 12, paddingHorizontal: 13, paddingVertical: 9 },
  retryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
});