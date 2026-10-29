// trip-cost.tsx — "Petty cash": a receipt with no request (snacks, gas for delivery,
// allowance, other). The file keeps its first name, "trip cost".
//
// Reached from "Check receipt" once the receipt has been scanned and confirmed. The
// person taps what it was for, writes a note saying what the expense was for, and ticks
// the projects it served; the server splits the total evenly and each project's Project
// Manager approves their share.
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import * as Crypto from "expo-crypto";

import { useExpenseDraft } from "@/lib/expense-draft-context";
import { dismissScan } from "@/lib/receipt-scans";
import { ApiError, submitTripCost, type OpenRequest, type TripCostSubmission } from "@/lib/api";
import { loadOpenRequests } from "@/lib/cached-api";
import { groupByProject } from "@/lib/project-groups";
import { formatPeso } from "@/lib/money";
import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { BlockedReasons } from "@/components/blocked-reasons";
import { FlowHeader } from "@/components/flow-header";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { LoadingOverlay } from "@/components/loading-overlay";
import { describeLoadError } from "@/lib/sync/messages";
import { useNetwork } from "@/lib/sync/network-context";
import { useLocale } from "@/lib/i18n-context";

// The buttons offered. The value is what the server stores.
const REASONS = [
  { value: "Snacks", labelKey: "tc.reason_snacks" },
  { value: "Gas", labelKey: "tc.reason_gas" },
  { value: "Allowance", labelKey: "tc.reason_allowance" },
  { value: "Other", labelKey: "tc.reason_other" },
] as const;

const NOTE_MAX = 300;

export default function TripCostScreen() {
  const { t } = useLocale();
  const { draft, reset } = useExpenseDraft();
  const { isOnline } = useNetwork();
  const receipt = draft.ocrResult;

  const [requests, setRequests] = useState<OpenRequest[]>([]);
  const [loading, setLoading] = useState(true);
  // No default: the person taps what the money was for.
  const [reason, setReason] = useState<TripCostSubmission["reason"] | null>(null);
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  // One ID for this receipt, kept across retries, so a lost response cannot save it twice.
  const commonReceiptID = React.useRef(Crypto.randomUUID()).current;

  useEffect(() => {
    loadOpenRequests()
      .then((result) => setRequests(result.data))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, []);

  // Only projects where the Purchaser has an open request can be charged.
  const projects = useMemo(
    () => groupByProject(requests, (r) => ({ id: r.projectID, name: r.projectName, at: r.createdAt })),
    [requests]
  );

  if (!receipt || draft.mode !== "split") return <Redirect href="/" />;

  const total = Number(receipt.amount);
  const totalOk = Number.isFinite(total) && total > 0;
  const each = totalOk && picked.length > 0 ? total / picked.length : 0;
  // What it was for (a button) and the note about it are both required.
  const noteOk = note.trim() !== "";
  const canSubmit = totalOk && !!reason && noteOk && picked.length > 0 && !submitting && !!receipt.receiptImageURL;
  // Everything still missing, listed above the Send button; the same items are tagged "Required" below.
  const reasonMissing = !reason;
  const noteMissing = !noteOk;
  const projectMissing = picked.length === 0 && !loading;
  const gaps = [
    reasonMissing && t("tc.reason_pick"),
    noteMissing && t("tc.note_required"),
    projectMissing && t("tc.pick_project"),
  ];

  function toggle(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  async function handleSubmit() {
    if (!canSubmit || !receipt || !reason) return;
    if (!isOnline) return Alert.alert(t("mx.offline_title"), t("al.offline_split"));
    setSubmitting(true);
    try {
      await submitTripCost({
        receiptImageURL: receipt.receiptImageURL as string,
        vendorName: receipt.vendorName ?? "",
        receiptDate: receipt.receiptDate ?? "",
        receiptTotal: total,
        reason,
        note: note.trim(),
        projectIds: picked,
        tin: receipt.tin,
        birPermitNumber: receipt.birPermitNumber,
        birNumber: receipt.birNumber,
        commonReceiptID,
      });
      setSent(true);
      // Submitted: take it off the Turn In list so it can't be sent twice.
      if (draft.scanID) dismissScan(draft.scanID).catch(() => {});
    } catch (err) {
      // 404: the server is an older version that has no trip-cost route yet.
      const body = err instanceof ApiError && err.status === 404 ? t("tc.server_old") : describeLoadError(err, true) ?? t("al.err_generic");
      Alert.alert(t("tc.failed"), body);
    } finally {
      setSubmitting(false);
    }
  }

  function finish() {
    router.replace("/turn-in");
    reset();
  }

  if (sent) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <FlowHeader title={t("tc.title")} hideBack />
        <View style={styles.container}>
          <View style={styles.sent}>
            <IconSymbol name="checkmark.circle.fill" size={22} color={COLORS.success} />
            <Text style={styles.sentText}>{t("tc.sent")}</Text>
          </View>
          <TouchableOpacity style={styles.submitButton} onPress={finish} accessibilityRole="button">
            <Text style={styles.submitButtonText}>{t("al2.back_turnin")}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlowHeader title={t("tc.title")} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.summary}>
          <View style={styles.flex}>
            <Text style={styles.summaryVendor} numberOfLines={1}>{receipt.vendorName || t("mobile.receipt")}</Text>
            <Text style={styles.muted}>{t("tc.help")}</Text>
          </View>
          {totalOk ? <Text style={styles.summaryTotal}>{formatPeso(total)}</Text> : null}
        </View>

        <Text style={styles.sectionTitle}>{t("tc.reason_title")}{reasonMissing ? <Text style={styles.requiredTag}>  {t("mx.required_tag")}</Text> : null}</Text>
        <View style={styles.chipRow}>
          {REASONS.map((r) => (
            <Pressable
              key={r.value}
              onPress={() => setReason(r.value)}
              style={[styles.chip, reason === r.value && styles.chipOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: reason === r.value }}
            >
              <Text style={[styles.chipText, reason === r.value && { color: COLORS.primary }]}>{t(r.labelKey)}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>{t("tc.note_label")}{noteMissing ? <Text style={styles.requiredTag}>  {t("mx.required_tag")}</Text> : null}</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder={t("tc.note_ph")}
          placeholderTextColor={COLORS.muted}
          maxLength={NOTE_MAX}
          multiline
          accessibilityLabel={t("tc.note_label")}
          style={styles.noteInput}
        />

        <Text style={styles.sectionTitle}>{t("tc.projects_title")}{projectMissing ? <Text style={styles.requiredTag}>  {t("mx.required_tag")}</Text> : null}</Text>
        {loading ? <ActivityIndicator color={COLORS.primary} /> : null}
        {!loading && projects.length === 0 ? <Text style={styles.muted}>{t("tc.no_projects")}</Text> : null}
        {projects.map((project) => {
          const on = picked.includes(project.projectId);
          return (
            <Pressable
              key={project.projectId}
              onPress={() => toggle(project.projectId)}
              style={({ pressed }) => [styles.projectRow, on && styles.projectRowOn, pressed && { opacity: 0.85 }]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
            >
              <View style={[styles.box, on && styles.boxOn]}>
                {on ? <IconSymbol name="checkmark.circle.fill" size={20} color="#FFFFFF" /> : null}
              </View>
              <Text style={styles.projectName} numberOfLines={2}>{project.projectName}</Text>
            </Pressable>
          );
        })}
        {picked.length > 0 && totalOk ? (
          <Text style={styles.muted}>{t("tc.share", { count: picked.length, each: formatPeso(each) })}</Text>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <BlockedReasons title={t("gap.title")} reasons={gaps} />
        <TouchableOpacity
          style={[styles.submitButton, !canSubmit && { opacity: 0.5 }]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit }}
        >
          <Text style={styles.submitButtonText}>{totalOk ? t("tc.submit", { amount: formatPeso(total) }) : t("tc.title")}</Text>
        </TouchableOpacity>
      </View>
      <LoadingOverlay visible={submitting} message={t("split.submitting")} detail={t("split.creating")} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  container: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },

  summary: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 12 },
  summaryVendor: { fontSize: 16, fontFamily: FONT.extrabold, color: COLORS.heading },
  summaryTotal: { fontSize: 20, fontFamily: FONT.extrabold, color: COLORS.primary },
  sectionTitle: { fontSize: 15, fontFamily: FONT.extrabold, color: COLORS.heading, marginTop: 8 },
  muted: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, lineHeight: 18 },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 22, paddingVertical: 8, paddingHorizontal: 18, backgroundColor: COLORS.card },
  chipOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryTint },
  chipText: { fontSize: 14, fontFamily: FONT.semibold, color: COLORS.heading },

  noteInput: { minHeight: 84, textAlignVertical: "top", backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: FONT.regular, color: COLORS.heading },

  projectRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: MIN_TAP + 8, backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 14, paddingVertical: 10 },
  projectRowOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryTint },
  projectName: { flex: 1, fontSize: 15, fontFamily: FONT.bold, color: COLORS.heading },
  box: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: COLORS.inputBorder, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.card },
  boxOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primary },

  sent: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: COLORS.successBg, borderRadius: 12, padding: 12 },
  sentText: { flex: 1, fontSize: 14, fontFamily: FONT.bold, color: COLORS.success },

  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, gap: 6, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.card },
  requiredTag: { fontSize: 11, fontFamily: FONT.bold, color: COLORS.errorText },
  helper: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, textAlign: "center" },
  submitButton: { minHeight: 52, backgroundColor: COLORS.primary, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  submitButtonText: { color: "#FFF", fontFamily: FONT.bold, fontSize: 16 },
});
