import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
      setTask(matchingTask);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load this task.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      if (session?.user.role === "Site Manager") loadTask();
    }, [loadTask, session?.user.role])
  );

  if (!session || session.user.role !== "Site Manager") return <Redirect href="/login" />;

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
      setSubmitError(null);
    }
  }

  async function chooseFromGallery() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photo access needed", "Enable photo access in your phone settings to add task evidence.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      selectionLimit: 1,
    });
    if (!result.canceled) {
      setPhoto(result.assets[0]);
      setClientSubmissionId(null);
      setSubmitted(false);
      setSubmitError(null);
    }
  }

  async function handleSubmit() {
    if (!task || !photo) {
      setSubmitError("Choose a photo before submitting progress.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const submissionId = clientSubmissionId || Crypto.randomUUID();
      if (!clientSubmissionId) setClientSubmissionId(submissionId);

      await submitTaskProgress(task.taskid, photo, note, submissionId);
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Unable to submit task progress.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={styles.content}
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
              <InfoRow label="Due date" value={formatDate(task.duedate)} />
              <InfoRow label="Task status" value={task.status} />
              <InfoRow label="Task ID" value={task.taskid} />
            </View>

            {task.status !== "Completed" && (
              <View style={styles.submissionSection}>
                <Text style={styles.sectionTitle}>Progress update</Text>
                <Text style={styles.sectionSubtitle}>Add one photo as evidence and an optional note.</Text>

                <View style={styles.photoActions}>
                  <Pressable onPress={takePhoto} style={styles.photoButton}>
                    <Text style={styles.photoButtonIcon}>⌾</Text>
                    <Text style={styles.photoButtonText}>Take photo</Text>
                  </Pressable>
                  <Pressable onPress={chooseFromGallery} style={styles.photoButton}>
                    <Text style={styles.photoButtonIcon}>▧</Text>
                    <Text style={styles.photoButtonText}>From gallery</Text>
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
                  textAlignVertical="top"
                />

                {submitError && <Text style={styles.submitError}>{submitError}</Text>}
                {submitted ? (
                  <View style={styles.successCard}>
                    <Text style={styles.successTitle}>Submitted for review</Text>
                    <Text style={styles.successBody}>
                      Your Project Manager can now review this progress update.
                    </Text>
                  </View>
                ) : (
                  <Pressable
                    disabled={submitting}
                    onPress={handleSubmit}
                    style={({ pressed }) => [styles.submitButton, pressed && styles.submitButtonPressed, submitting && styles.submitButtonDisabled]}
                  >
                    {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.submitButtonText}>Submit for PM review</Text>}
                  </Pressable>
                )}
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
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
  centerState: { alignItems: "center", paddingVertical: 80 },
  stateBody: { color: COLORS.muted, fontSize: 13, marginTop: 10 },
  errorCard: { backgroundColor: "#FFF5F3", borderColor: "#F4C7C3", borderRadius: 16, borderWidth: 1, padding: 16 },
  errorTitle: { color: "#B42318", fontSize: 15, fontWeight: "800" },
  errorBody: { color: "#8C2D24", fontSize: 13, lineHeight: 19, marginTop: 6 },
  retryButton: { alignSelf: "flex-start", backgroundColor: COLORS.primary, borderRadius: 10, marginTop: 12, paddingHorizontal: 13, paddingVertical: 9 },
  retryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
});
