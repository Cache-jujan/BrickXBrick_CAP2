import React, { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";

import { useExpenseDraft } from "@/lib/expense-draft-context";
import { resolveTicket, submitExpense } from "@/lib/api";
import { COLORS } from "@/constants/expense-flow-colors";

const CATEGORIES = ["Materials", "Equipment", "Other"] as const;

export default function LinkScreen() {
  const { draft, setCategory: setDraftCategory, setNotes: setDraftNotes, reset } = useExpenseDraft();
  const { ticket, ocrResult } = draft;
  const [category, setCategory] = useState<(typeof CATEGORIES)[number] | null>(draft.category as any);
  const [notes, setNotes] = useState(draft.notes);
  const [submitting, setSubmitting] = useState(false);

  // All hooks are above this line. Direct deep link / hot reload with an empty draft lands here.
  if (!ticket || !ocrResult) return <Redirect href="/" />;

  // Arrow function declared AFTER the guard, so ticket/ocrResult stay narrowed inside it.
  const handleSubmit = async () => {
    if (submitting) return; // double-tap guard
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

    setSubmitting(true);
    try {
      // 2) Resolve the ticket. "Already resolved" (retry / dropped response) is not a failure.
      try {
        await resolveTicket(ticket.ticketId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/cannot move ticket from resolved/i.test(msg)) throw err;
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

      Alert.alert("Expense submitted", "Your expense was submitted successfully.");
      router.replace("/");
      reset();
    } catch (err) {
      Alert.alert("Submission failed", err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const total = (ocrResult.lineItems ?? []).reduce((s, i) => s + (i.amount || 0), 0);
  
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.subtitle}>Verify ticket & allocation</Text>
        <Text style={styles.title}>Link Expense</Text>

        <View style={styles.ticketCard}>
          <Text style={styles.ticketBadge}>✓ Auto-linked</Text>
          <Text style={styles.ticketSubject}>{ticket.subject}</Text>
          <Text style={styles.ticketMeta}>{ticket.projectName}</Text>
          {ticket.budget && <Text style={styles.ticketBudget}>Budget ₱{Number(ticket.budget).toLocaleString()}</Text>}
        </View>

        <Text style={styles.fieldLabel}>Category</Text>
        <View style={styles.categoryGrid}>
          {CATEGORIES.map((c) => (
            <TouchableOpacity key={c} style={[styles.categoryChip, category === c && styles.categoryChipActive]} onPress={() => { setCategory(c); setDraftCategory(c); }}>
              <Text style={[styles.categoryChipText, category === c && styles.categoryChipTextActive]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.fieldLabel}>Notes (optional)</Text>
        <TextInput style={styles.notesInput} multiline numberOfLines={3} value={notes} onChangeText={(v) => { setNotes(v); setDraftNotes(v); }} placeholder="Add delivery details, invoice note, or field comments..." />

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>{(ocrResult.lineItems ?? []).length} item(s)</Text>
          <Text style={styles.summaryAmount}>₱{total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
        </View>

        <TouchableOpacity style={[styles.submitButton, submitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting}>
          <Text style={styles.submitButtonText}>{submitting ? "Submitting…" : "Submit Expense for Approval"}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1, padding: 20 },
  subtitle: { fontSize: 12, color: COLORS.muted },
  title: { fontSize: 20, fontWeight: "800", color: COLORS.heading, marginBottom: 14 },
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