import React, { useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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
import { COLORS } from "@/constants/expense-flow-colors";
import { FlowHeader } from "@/components/flow-header";
import { LoadingOverlay } from "@/components/loading-overlay";
import { formatPeso } from "@/lib/money";

const CATEGORIES = ["Materials", "Equipment", "Other"] as const;

export default function LinkScreen() {
  const { draft, setCategory: setDraftCategory, setNotes: setDraftNotes, reset } = useExpenseDraft();
  const { isOnline, refreshPendingCount } = useNetwork();
  const { ticket, ocrResult } = draft;
  const [category, setCategory] = useState<(typeof CATEGORIES)[number] | null>(draft.category as any);
  const [notes, setNotes] = useState(draft.notes);
  const [submitting, setSubmitting] = useState(false);
  // setState is async; the ref stops a fast double tap from submitting twice.
  const busyRef = useRef(false);

  // All hooks are above this line. Direct deep link / hot reload with an empty draft lands here.
  // A rejected expense being resubmitted may have no ticket on hand: the server keeps its link.
  if (!ocrResult || (!ticket && !draft.resubmit)) return <Redirect href="/" />;

  // Arrow function declared AFTER the guard, so ocrResult stays narrowed inside it.
  const handleSubmit = async () => {
    if (busyRef.current) return; // double-tap guard
    if (!category) return Alert.alert("Category required", "Pick a category before submitting.");

    // 1) Validate everything BEFORE touching the ticket, so a bad draft can't leave it Resolved.
    const amountNum = typeof ocrResult.amount === "number" ? ocrResult.amount : Number(ocrResult.amount);
    if (!Number.isFinite(amountNum)) {
      return Alert.alert("Invalid amount", "Go back and check the receipt total.");
    }
    if (!ocrResult.receiptImageURL) {
      return Alert.alert("Missing receipt image", "Please rescan the receipt.");
    }
    const lineItems = ocrResult.lineItems ?? [];
    if (lineItems.length === 0) {
      return Alert.alert("No line items", "Add at least one item on the Review screen.");
    }

    // Resubmitting a Rejected expense needs the server (it edits the existing row),
    // so it can't be queued offline.
    if (!isOnline && draft.resubmit) {
      return Alert.alert("You're offline", "Reconnect to resubmit a rejected expense.");
    }

    busyRef.current = true;
    setSubmitting(true);
    try {
      // F10 — offline: queue the expense in SQLite instead of POSTing.
      // The server (POST /api/sync) runs the full validation + screening on reconnect.
      if (!isOnline) {
        if (!ticket) throw new Error("This receipt isn't linked to a request. Open the request and try again.");

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
          throw new Error("Could not save this expense offline. Reconnect to sync before saving more.");
        }

        refreshPendingCount();
        if (draft.scanID) dismissScan(draft.scanID).catch(() => {});
        Alert.alert("Saved offline", "Your expense will be submitted automatically when you're back online.");
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
        Alert.alert("Expense resubmitted", "Your Project Manager will review it again.");
        router.replace("/");
        reset();
        return;
      }

      if (!ticket) throw new Error("This receipt isn't linked to a request. Open the request and try again.");

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
      Alert.alert("Expense submitted", "Your expense was submitted successfully.");
      router.replace("/");
      reset();
    } catch (err) {
      if (isNetworkError(err)) {
        // The connection dropped mid-submit. Don't show the raw server error.
        // It may or may not have reached the server, so don't save a second copy
        // offline either (that could create a duplicate expense).
        Alert.alert(
          "Connection lost",
          "We couldn't reach the server, so we can't confirm this expense went through. Check your connection, then look in your expenses before trying again."
        );
      } else {
        Alert.alert("Submission failed", err instanceof Error ? err.message : String(err));
      }
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  };

  const itemCount = (ocrResult.lineItems ?? []).length;

  const submitLabel = !category
    ? "Pick a category"
    : draft.resubmit
      ? "Resubmit for approval"
      : isOnline
        ? "Submit for approval"
        : "Save offline";

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlowHeader title={draft.resubmit ? "Resubmit expense" : "Link & submit"} caption="Step 3 of 3" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          {ticket ? (
            <View style={styles.ticketCard}>
              <Text style={styles.ticketBadge}>{draft.resubmit ? "Original request" : "✓ Linked to this request"}</Text>
              <Text style={styles.ticketSubject}>{ticket.subject}</Text>
              <Text style={styles.ticketMeta}>{ticket.projectName}</Text>
              {ticket.budget && <Text style={styles.ticketBudget}>Approved budget {formatPeso(ticket.budget)}</Text>}
            </View>
          ) : null}

          <View style={styles.receiptCard}>
            <Text style={styles.receiptVendor} numberOfLines={1}>{ocrResult.vendorName || "Vendor"}</Text>
            <Text style={styles.ticketMeta}>{ocrResult.receiptDate} · {itemCount} item{itemCount === 1 ? "" : "s"}</Text>
          </View>

          <Text style={styles.fieldLabel}>Category</Text>
          <View style={styles.categoryGrid}>
            {CATEGORIES.map((c) => (
              <Pressable key={c} style={[styles.categoryChip, category === c && styles.categoryChipActive]} onPress={() => { setCategory(c); setDraftCategory(c); }}>
                <Text style={[styles.categoryChipText, category === c && styles.categoryChipTextActive]}>{c}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Notes (optional)</Text>
          <TextInput style={styles.notesInput} multiline numberOfLines={3} value={notes} onChangeText={(v) => { setNotes(v); setDraftNotes(v); }} placeholder="Add delivery details, invoice note, or field comments..." placeholderTextColor={COLORS.muted} />
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Receipt total</Text>
            <Text style={styles.summaryAmount}>{formatPeso(ocrResult.amount)}</Text>
          </View>
          <Pressable style={[styles.submitButton, (!category || submitting) && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting} accessibilityRole="button">
            <Text style={styles.submitButtonText}>{submitLabel}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <LoadingOverlay visible={submitting} message={draft.resubmit ? "Resubmitting expense…" : isOnline ? "Submitting expense…" : "Saving offline…"} detail={isOnline ? "Running the screening checks." : "Queuing on this device."} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  container: { paddingHorizontal: 16, paddingBottom: 24 },
  receiptCard: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginBottom: 16 },
  receiptVendor: { fontSize: 15, fontWeight: "700", color: COLORS.heading },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.bg },
  ticketCard: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.primary, padding: 14, marginBottom: 16 },
  ticketBadge: { fontSize: 11, fontWeight: "700", color: COLORS.success, marginBottom: 4 },
  ticketSubject: { fontSize: 15, fontWeight: "700", color: COLORS.heading },
  ticketMeta: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  ticketBudget: { fontSize: 12, fontWeight: "700", color: COLORS.heading, marginTop: 6 },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: COLORS.muted, marginBottom: 6, marginTop: 4 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  categoryChip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: COLORS.card },
  categoryChipActive: { borderColor: COLORS.primary, backgroundColor: "#FDECE1" },
  categoryChipText: { fontSize: 12, fontWeight: "600", color: COLORS.heading },
  categoryChipTextActive: { color: COLORS.primary },
  notesInput: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 12, fontSize: 13, color: COLORS.heading, textAlignVertical: "top", minHeight: 70, marginBottom: 14 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  summaryLabel: { fontSize: 12, color: COLORS.muted },
  summaryAmount: { fontSize: 20, fontWeight: "800", color: COLORS.heading },
  submitButton: { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  submitButtonText: { color: "#FFF", fontWeight: "700", fontSize: 15 },
});