import React, { useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import * as Crypto from "expo-crypto";

import { useExpenseDraft } from "@/lib/expense-draft-context";
import { dismissScan } from "@/lib/receipt-scans";
import { getSession } from "@/lib/auth";
import { resolveTicket, resubmitExpense, submitExpense } from "@/lib/api";
import { canEnqueue, queueExpense } from "@/lib/sync/db";
import { useNetwork } from "@/lib/sync/network-context";
import { isNetworkError } from "@/lib/sync/messages";
import { COLORS, FONT } from "@/constants/expense-flow-colors";
import { FlowHeader } from "@/components/flow-header";
import { LoadingOverlay } from "@/components/loading-overlay";
import { BlockedReasons, fieldErrorStyle } from "@/components/blocked-reasons";
import { formatPeso } from "@/lib/money";
import { KeyboardAvoider } from "@/components/keyboard-avoider";
import { useLocale } from "@/lib/i18n-context";

const CATEGORIES = ["Materials", "Equipment", "Other"] as const;

export default function LinkScreen() {
  const { t, tv } = useLocale();
  const { draft, setCategory: setDraftCategory, setNotes: setDraftNotes, reset } = useExpenseDraft();
  const { isOnline, refreshPendingCount } = useNetwork();
  const { ticket, ocrResult } = draft;
  const [category, setCategory] = useState<(typeof CATEGORIES)[number] | null>(draft.category as any);
  const [notes, setNotes] = useState(draft.notes);
  const [submitting, setSubmitting] = useState(false);
  // setState is async; the ref stops a fast double tap from submitting twice.
  const busyRef = useRef(false);
  // Set when Submit is tapped without a category, so the chips turn red.
  const [triedSubmit, setTriedSubmit] = useState(false);

  // All hooks are above this line. Direct deep link / hot reload with an empty draft lands here.
  // A rejected expense being resubmitted may have no ticket on hand: the server keeps its link.
  if (!ocrResult || (!ticket && !draft.resubmit)) return <Redirect href="/" />;

  // Arrow function declared AFTER the guard, so ocrResult stays narrowed inside it.
  const handleSubmit = async () => {
    if (busyRef.current) return; // double-tap guard
    if (!category) {
      setTriedSubmit(true);
      return;
    }

    // 1) Validate everything BEFORE touching the ticket, so a bad draft can't leave it Resolved.
    const amountNum = typeof ocrResult.amount === "number" ? ocrResult.amount : Number(ocrResult.amount);
    if (!Number.isFinite(amountNum)) {
      return Alert.alert(t("mx.invalid_amount_title"), t("mx.invalid_amount_body"));
    }
    if (!ocrResult.receiptImageURL) {
      return Alert.alert(t("mx.missing_image_title"), t("mx.missing_image_body"));
    }
    const lineItems = ocrResult.lineItems ?? [];
    if (lineItems.length === 0) {
      return Alert.alert(t("mx.no_items_title"), t("mx.no_items_body"));
    }

    // Resubmitting a Rejected expense needs the server (it edits the existing row),
    // so it can't be queued offline.
    if (!isOnline && draft.resubmit) {
      return Alert.alert(t("mx.offline_title"), t("mx.offline_resubmit"));
    }

    busyRef.current = true;
    setSubmitting(true);
    try {
      // F10 — offline: queue the expense in SQLite instead of POSTing.
      // The server (POST /api/sync) runs the full validation + screening on reconnect.
      if (!isOnline) {
        if (!ticket) throw new Error(t("mx.not_linked"));

        const gate = canEnqueue();
        if (!gate.allowed) throw new Error(gate.message);

        const queued = queueExpense(Crypto.randomUUID(), {
          ticketID: ticket.ticketId,
          vendorName: ocrResult.vendorName,
          amount: amountNum,
          receiptDate: ocrResult.receiptDate,
          category,
          receiptImageURL: ocrResult.receiptImageURL,
          birNumber: ocrResult.birNumber,
          tin: ocrResult.tin,
          birPermitNumber: ocrResult.birPermitNumber,
          lineItems,
        });
        if (!queued) {
          throw new Error(t("mx.offline_save_failed"));
        }

        refreshPendingCount();
        if (draft.scanID) dismissScan(draft.scanID).catch(() => {});
        Alert.alert(t("mx.saved_offline_title"), t("mx.saved_offline_body"));
        router.replace("/");
        reset();
        return;
      }

      // Correcting a Rejected expense: update it in place. The receipt, ticket
      // and project stay as they were, and the server screens it again.
      if (draft.resubmit) {
        await resubmitExpense(draft.resubmit.expenseID, {
          vendorName: ocrResult.vendorName,
          amount: amountNum,
          receiptDate: ocrResult.receiptDate,
          category,
          birNumber: ocrResult.birNumber,
          tin: ocrResult.tin,
          birPermitNumber: ocrResult.birPermitNumber,
          lineItems,
        });
        Alert.alert(t("mx.resubmitted_title"), t("mx.resubmitted_body"));
        router.replace("/");
        reset();
        return;
      }

      if (!ticket) throw new Error(t("mx.not_linked"));

      // 2) Purchasers resolve the ticket after capture. Site Managers arrive
      // only through their own already-resolved Material Request tickets.
      if (getSession()?.user.role !== "Site Manager") {
        try {
          await resolveTicket(ticket.ticketId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!/cannot move ticket from resolved/i.test(msg)) throw err;
        }
      }

      // 3) Submit the expense.
      await submitExpense({
        ticketID: ticket.ticketId,
        vendorName: ocrResult.vendorName,
        amount: amountNum,
        receiptDate: ocrResult.receiptDate,
        category,
        receiptImageURL: ocrResult.receiptImageURL,
        birNumber: ocrResult.birNumber,
        tin: ocrResult.tin,
        birPermitNumber: ocrResult.birPermitNumber,
        lineItems,
      });

      // Submitted: take it off "Scanned receipts" so it can't be sent twice.
      if (draft.scanID) dismissScan(draft.scanID).catch(() => {});
      Alert.alert(t("mx.submitted_title"), t("mx.submitted_body"));
      router.replace("/");
      reset();
    } catch (err) {
      if (isNetworkError(err)) {
        // The connection dropped mid-submit. Don't show the raw server error.
        // It may or may not have reached the server, so don't save a second copy
        // offline either (that could create a duplicate expense).
        Alert.alert(t("mx.conn_lost_title"), t("mx.conn_lost_body"));
      } else {
        Alert.alert(t("mx.submission_failed"), err instanceof Error ? err.message : String(err));
      }
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  };

  const itemCount = (ocrResult.lineItems ?? []).length;

  const submitLabel = !category
    ? t("mx.pick_category")
    : draft.resubmit
      ? t("mx.resubmit_approval")
      : isOnline
        ? t("mx.submit_approval")
        : t("mx.save_offline");

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlowHeader title={draft.resubmit ? t("mx.resubmit_title") : t("mx.link_submit")} caption={t("mx.step_n", { current: 3, total: 3 })} />
      <KeyboardAvoider style={styles.flex}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          {ticket ? (
            <View style={styles.ticketCard}>
              <Text style={styles.ticketBadge}>{draft.resubmit ? t("mx.original_request") : t("mx.linked")}</Text>
              <Text style={styles.ticketSubject}>{ticket.subject}</Text>
              <Text style={styles.ticketMeta}>{ticket.projectName}</Text>
              {ticket.budget && <Text style={styles.ticketBudget}>{t("mx.approved_budget", { amount: formatPeso(ticket.budget) })}</Text>}
            </View>
          ) : null}

          <View style={styles.receiptCard}>
            <Text style={styles.receiptVendor} numberOfLines={1}>{ocrResult.vendorName || t("dashboard.vendor")}</Text>
            <Text style={styles.ticketMeta}>{itemCount === 1 ? t("mx.receipt_meta_one", { date: ocrResult.receiptDate ?? "" }) : t("mx.receipt_meta_other", { date: ocrResult.receiptDate ?? "", count: itemCount })}</Text>
          </View>

          <Text style={[styles.fieldLabel, triedSubmit && !category && styles.fieldLabelError]}>
            {t("mx.category")}{triedSubmit && !category ? t("mx.required_suffix") : ""}
          </Text>
          <View style={styles.categoryGrid}>
            {CATEGORIES.map((c) => (
              <Pressable key={c} style={[styles.categoryChip, triedSubmit && !category && fieldErrorStyle, category === c && styles.categoryChipActive]} onPress={() => { setCategory(c); setDraftCategory(c); }}>
                <Text style={[styles.categoryChipText, category === c && styles.categoryChipTextActive]}>{tv("category", c)}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>{t("mx.notes_optional")}</Text>
          <TextInput style={styles.notesInput} multiline numberOfLines={3} value={notes} onChangeText={(v) => { setNotes(v); setDraftNotes(v); }} placeholder={t("mx.notes_ph")} placeholderTextColor={COLORS.muted} />
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{t("mx.receipt_total")}</Text>
            <Text style={styles.summaryAmount}>{formatPeso(ocrResult.amount)}</Text>
          </View>
          <BlockedReasons reasons={[triedSubmit && !category && t("mx.pick_category_hint")]} />
          <Pressable style={[styles.submitButton, (!category || submitting) && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting} accessibilityRole="button">
            <Text style={styles.submitButtonText}>{submitLabel}</Text>
          </Pressable>
        </View>
      </KeyboardAvoider>

      <LoadingOverlay visible={submitting} message={draft.resubmit ? t("mx.resubmitting") : isOnline ? t("submit.submitting") : t("mx.saving_offline")} detail={isOnline ? t("mx.screening") : t("mx.queuing")} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  container: { paddingHorizontal: 16, paddingBottom: 24 },
  receiptCard: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginBottom: 16 },
  receiptVendor: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.heading },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.bg },
  ticketCard: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.primary, padding: 14, marginBottom: 16 },
  ticketBadge: { fontSize: 11, fontFamily: FONT.bold, color: COLORS.success, marginBottom: 4 },
  ticketSubject: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.heading },
  ticketMeta: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 2 },
  ticketBudget: { fontSize: 12, fontFamily: FONT.bold, color: COLORS.heading, marginTop: 6 },
  fieldLabelError: { color: COLORS.errorText },
  fieldLabel: { fontSize: 12, fontFamily: FONT.semibold, color: COLORS.muted, marginBottom: 6, marginTop: 4 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  categoryChip: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: COLORS.card },
  categoryChipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryTint },
  categoryChipText: { fontSize: 12, fontFamily: FONT.semibold, color: COLORS.heading },
  categoryChipTextActive: { color: COLORS.primary },
  notesInput: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 12, fontSize: 13, fontFamily: FONT.regular, color: COLORS.heading, textAlignVertical: "top", minHeight: 70, marginBottom: 14 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  summaryLabel: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted },
  summaryAmount: { fontSize: 20, fontFamily: FONT.extrabold, color: COLORS.heading },
  submitButton: { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  submitButtonText: { color: "#FFF", fontFamily: FONT.bold, fontSize: 15 },
});