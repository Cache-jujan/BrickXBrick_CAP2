import { useCallback, useState } from "react";
import { ActivityIndicator, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Redirect, Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { AppButton } from "@/components/app-button";
import { FlowHeader } from "@/components/flow-header";
import { KeyboardScreen } from "@/components/screen";
import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { type CheckinDetail } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { loadAssignedTasks, loadCheckinDetail } from "@/lib/cached-api";
import { SLOT_LABEL } from "@/lib/sync/checkin";
import { getPendingCheckinById } from "@/lib/sync/db";
import { describeLoadError } from "@/lib/sync/messages";
import { useNetwork } from "@/lib/sync/network-context";
import { savedAtLabel } from "@/lib/sync/offline-cache";
import { useLocale } from "@/lib/i18n-context";

// What the Site Manager sent, read-only. The id is either the server's check-in
// id (already sent) or the phone's own id (still waiting to be sent).
type Shown = Pick<CheckinDetail, "day" | "slotLabel" | "siteStatus" | "summary" | "issues" | "needsPmAction" | "photos" | "tasks" | "review"> & {
  projectName: string | null;
  sent: boolean;
};

const STATUS_COLOR: Record<string, string> = {
  "On Track": COLORS.success,
  Delayed: COLORS.amberBannerText,
  Blocked: COLORS.errorText,
};

// A photo that cannot load (offline, bad link) shows a labelled box, not a blank.
function PhotoThumb({ uri, index }: { uri: string; index: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View style={[styles.photoBox, styles.photoMissing]} accessibilityLabel={`Photo ${index + 1} could not be loaded`}>
        <Text style={styles.photoMissingTitle}>Photo {index + 1}</Text>
        <Text style={styles.photoMissingText}>Could not be loaded</Text>
      </View>
    );
  }
  return <Image source={{ uri }} style={styles.photoBox} onError={() => setFailed(true)} accessibilityLabel={`Photo ${index + 1}`} />;
}

export default function SiteManagerCheckinViewScreen() {
  const { t, intlLocale } = useLocale();
  const session = getSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isOnline } = useNetwork();
  const [item, setItem] = useState<Shown | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!id || !session) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const queued = getPendingCheckinById(id, session.user.id);
        if (queued) {
          // Not sent yet: show the copy saved on this phone.
          const names = await loadAssignedTasks().then((r) => r.data, () => []);
          setSavedAt(null);
          setItem({
            day: queued.checkin_date,
            slotLabel: SLOT_LABEL[queued.slot as keyof typeof SLOT_LABEL] ?? queued.slot,
            siteStatus: queued.site_status,
            summary: queued.summary,
            issues: queued.issues,
            needsPmAction: queued.needs_pm_action,
            photos: queued.photo_paths.map((p: string) => (p.startsWith("file://") ? p : `file://${p}`)),
            tasks: queued.task_ids.map((taskId: string) => ({
              taskId,
              taskName: names.find((t) => t.taskid === taskId)?.taskname ?? "A task",
            })),
            review: null,
            projectName: null,
            sent: false,
          });
          return;
        }
        const result = await loadCheckinDetail(id);
        setSavedAt(result.fromCache ? result.savedAt : null);
        setItem({ ...result.data, sent: true });
      } catch (err) {
        setError(describeLoadError(err, isOnline) ?? "This check-in isn't saved on this phone. Connect to see it.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id, session, isOnline]
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!session || session.user.role !== "Site Manager") return <Redirect href="/login" />;

  const review = item?.review ?? null;

  return (
    <KeyboardScreen
      background={COLORS.bgWarm}
      header={<FlowHeader variant="bar" title="Your check-in" fallback="/site-manager/checkin" />}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
    >
      <Stack.Screen options={{ headerShown: false }} />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : error || !item ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Couldn’t load this check-in</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <AppButton label="Try again" variant="secondary" onPress={() => load()} />
        </View>
      ) : (
        <>
          {savedAt && <Text style={styles.savedNote}>Saved copy {savedAtLabel(savedAt, new Date(), t, intlLocale)}. The review below may be out of date.</Text>}
          <Text style={styles.eyebrow}>{item.day}</Text>
          <Text style={styles.title}>{item.slotLabel} check-in</Text>
          {item.projectName && <Text style={styles.muted}>{item.projectName}</Text>}

          {!item.sent ? (
            <View style={styles.pendingCard}>
              <Text style={styles.pendingText}>Saved on this phone. It will be sent when you're back online.</Text>
            </View>
          ) : review ? (
            <View style={[styles.reviewCard, review.decision === "Flagged" ? styles.flagged : styles.acked]}>
              <Text style={[styles.reviewTitle, { color: review.decision === "Flagged" ? COLORS.errorText : COLORS.success }]}>
                {review.decision === "Flagged" ? "Flagged by your Project Manager" : "Acknowledged by your Project Manager"}
              </Text>
              {review.comment ? <Text style={styles.reviewBody}>{review.comment}</Text> : null}
              {review.reviewedByName ? <Text style={styles.hint}>{review.reviewedByName}</Text> : null}
            </View>
          ) : (
            <View style={styles.pendingCard}>
              <Text style={styles.pendingText}>Sent. Your Project Manager hasn't reviewed it yet.</Text>
            </View>
          )}

          <Text style={styles.label}>Site status</Text>
          <Text style={[styles.status, { color: STATUS_COLOR[item.siteStatus] ?? COLORS.heading }]}>{item.siteStatus}</Text>

          <Text style={styles.label}>Summary</Text>
          <Text style={styles.body}>{item.summary}</Text>

          {item.issues ? (
            <>
              <Text style={styles.label}>Issues</Text>
              <Text style={styles.body}>{item.issues}</Text>
            </>
          ) : null}
          {item.needsPmAction && <Text style={styles.hint}>You asked your Project Manager to act on this.</Text>}

          {item.tasks.length > 0 && (
            <>
              <Text style={styles.label}>Tasks this is about</Text>
              <View style={styles.chipRow}>
                {item.tasks.map((t) => (
                  <View key={t.taskId} style={styles.chip}>
                    <Text style={styles.chipText} numberOfLines={1}>{t.taskName}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {item.photos.length > 0 && (
            <>
              <Text style={styles.label}>Photos</Text>
              <View style={styles.photoRow}>
                {item.photos.map((uri, i) => (
                  <PhotoThumb key={uri} uri={uri} index={i} />
                ))}
              </View>
            </>
          )}

          <Pressable onPress={() => router.replace("/site-manager/checkin")} style={styles.back} accessibilityRole="button">
            <Text style={styles.backText}>Back to check-ins</Text>
          </Pressable>
        </>
      )}
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, gap: 8 },
  center: { alignItems: "center", paddingVertical: 48 },
  eyebrow: { color: COLORS.primary, fontFamily: FONT.extrabold, fontSize: 12, letterSpacing: 1 },
  title: { color: COLORS.heading, fontFamily: FONT.extrabold, fontSize: 24 },
  muted: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 14 },
  hint: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 12 },
  label: { color: COLORS.heading, fontFamily: FONT.bold, fontSize: 14, marginTop: 12 },
  status: { fontFamily: FONT.extrabold, fontSize: 18 },
  body: { color: COLORS.heading, fontFamily: FONT.regular, fontSize: 15 },
  savedNote: { color: COLORS.amberBannerText, backgroundColor: COLORS.amberBannerFill, padding: 8, borderRadius: 8, fontFamily: FONT.medium, fontSize: 12 },
  errorCard: { backgroundColor: COLORS.errorFill, borderColor: COLORS.errorBorder, borderWidth: 1, borderRadius: 12, padding: 12, gap: 6, marginTop: 8 },
  errorTitle: { color: COLORS.errorText, fontFamily: FONT.extrabold, fontSize: 14 },
  errorBody: { color: COLORS.errorText, fontFamily: FONT.regular, fontSize: 13 },
  pendingCard: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 8 },
  pendingText: { color: COLORS.muted, fontFamily: FONT.medium, fontSize: 13 },
  reviewCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4, marginTop: 8 },
  flagged: { backgroundColor: COLORS.errorFill, borderColor: COLORS.errorBorder },
  acked: { backgroundColor: COLORS.successBg, borderColor: COLORS.success },
  reviewTitle: { fontFamily: FONT.extrabold, fontSize: 14 },
  reviewBody: { color: COLORS.heading, fontFamily: FONT.regular, fontSize: 14 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 36, paddingHorizontal: 12, justifyContent: "center", borderRadius: 18, borderWidth: 1, borderColor: COLORS.inputBorder, backgroundColor: COLORS.card, maxWidth: "100%" },
  chipText: { color: COLORS.heading, fontFamily: FONT.semibold, fontSize: 13 },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photoBox: { width: 96, height: 96, borderRadius: 12, overflow: "hidden" },
  photoMissing: { borderWidth: 1, borderStyle: "dashed", borderColor: COLORS.inputBorder, backgroundColor: COLORS.card, alignItems: "center", justifyContent: "center", padding: 6 },
  photoMissingTitle: { color: COLORS.heading, fontFamily: FONT.bold, fontSize: 12 },
  photoMissingText: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 11, textAlign: "center" },
  back: { minHeight: MIN_TAP, alignItems: "center", justifyContent: "center", marginTop: 12 },
  backText: { color: COLORS.primary, fontFamily: FONT.bold, fontSize: 14 },
});
