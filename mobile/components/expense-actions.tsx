import React, { useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { fetchActiveProjects, fetchAllAssignedTickets, type Ticket } from "@/lib/api";
import { useExpenseDraft } from "@/lib/expense-draft-context";
import { formatPeso } from "@/lib/money";

type Choice = { ticket: Ticket; projectName: string };

// The fixed two-button bar on the Requests and Expenses screens.
// "Submit expense" asks which request the receipt is for, then opens the
// capture step. "Split receipt" starts the split flow (no request needed).
export function ExpenseActions() {
  const { reset, setTicket, startSplit } = useExpenseDraft();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);

  async function openPicker() {
    setPickerOpen(true);
    setLoading(true);
    setError(null);
    try {
      const [tickets, projects] = await Promise.all([fetchAllAssignedTickets("Purchaser"), fetchActiveProjects()]);
      const names = new Map(projects.map((p) => [p.projectid, p.name]));
      setChoices(
        tickets
          .filter((t) => t.status === "Acknowledged")
          .map((ticket) => ({ ticket, projectName: names.get(ticket.projectid) ?? "Unknown project" }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your requests.");
    } finally {
      setLoading(false);
    }
  }

  function choose({ ticket, projectName }: Choice) {
    setPickerOpen(false);
    reset();
    setTicket({
      ticketId: ticket.ticketid,
      projectId: ticket.projectid,
      projectName,
      subject: ticket.subject,
      budget: ticket.approvedbudget == null ? undefined : String(ticket.approvedbudget),
    });
    router.push("/expense/capture");
  }

  function split() {
    startSplit();
    router.push("/expense/capture");
  }

  return (
    <>
      <View style={styles.bar}>
        <Pressable onPress={openPicker} style={({ pressed }) => [styles.button, styles.filled, pressed && styles.pressed]} accessibilityRole="button">
          <Text style={styles.filledText}>Submit expense</Text>
        </Pressable>
        <Pressable onPress={split} style={({ pressed }) => [styles.button, styles.outlined, pressed && styles.pressed]} accessibilityRole="button">
          <Text style={styles.outlinedText}>Split receipt</Text>
        </Pressable>
      </View>

      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Which request is this for?</Text>
            <Pressable onPress={() => setPickerOpen(false)} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          {loading ? (
            <ActivityIndicator style={styles.center} color={COLORS.primary} />
          ) : error ? (
            <Text style={[styles.note, { color: COLORS.errorText }]}>{error}</Text>
          ) : (
            <FlatList
              data={choices}
              keyExtractor={(c) => c.ticket.ticketid}
              contentContainerStyle={styles.list}
              ListEmptyComponent={<Text style={styles.note}>No requests are waiting to be purchased.</Text>}
              renderItem={({ item }) => (
                <Pressable onPress={() => choose(item)} style={({ pressed }) => [styles.choice, pressed && styles.pressed]} accessibilityRole="button">
                  <Text style={styles.choiceTitle} numberOfLines={2}>{item.ticket.subject}</Text>
                  <Text style={styles.choiceMeta} numberOfLines={1}>
                    {item.projectName}{item.ticket.approvedbudget != null ? ` · ${formatPeso(item.ticket.approvedbudget)}` : ""}
                  </Text>
                </Pressable>
              )}
            />
          )}
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, backgroundColor: COLORS.card, borderTopWidth: 1, borderTopColor: COLORS.border },
  button: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  filled: { backgroundColor: COLORS.primary },
  filledText: { color: "#FFFFFF", fontSize: 15, fontFamily: FONT.bold },
  outlined: { borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: COLORS.card },
  outlinedText: { color: COLORS.primary, fontSize: 15, fontFamily: FONT.bold },
  pressed: { opacity: 0.85 },
  modal: { flex: 1, backgroundColor: COLORS.bg },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 16, paddingRight: 8, minHeight: MIN_TAP + 12 },
  modalTitle: { flex: 1, fontSize: 18, fontFamily: FONT.extrabold, color: COLORS.heading },
  close: { minHeight: MIN_TAP, minWidth: MIN_TAP, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  closeText: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.primary },
  center: { marginTop: 40 },
  list: { padding: 16, gap: 10 },
  note: { textAlign: "center", marginTop: 40, paddingHorizontal: 16, fontSize: 14, fontFamily: FONT.regular, color: COLORS.muted },
  choice: { minHeight: MIN_TAP, backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 14 },
  choiceTitle: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.heading },
  choiceMeta: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 2 },
});
