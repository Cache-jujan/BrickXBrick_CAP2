import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { OpenRequest } from "@/lib/api";
import { formatPeso, formatQty } from "@/lib/money";
import { parseNeededBy } from "@/lib/needed-by";
import { COLORS, FONT } from "@/constants/expense-flow-colors";
import { AppButton } from "@/components/app-button";
import { useLocale } from "@/lib/i18n-context";

type Props = {
  /** The request to show; null keeps the sheet closed. */
  request: OpenRequest | null;
  /** Purchasers can start a receipt for this exact request from here. */
  canSnap: boolean;
  onSnap: (request: OpenRequest) => void;
  onClose: () => void;
};

// Opened by tapping a request on To Buy (components/to-buy.tsx): everything the
// buyer needs before going to the store, then "Snap receipt for this request".
// Later: the BOM reference pictures the PM attaches to the item go under the
// details (Carl's BOM pictures task).
export function RequestDetailsSheet({ request, canSnap, onSnap, onClose }: Props) {
  const { t, intlLocale } = useLocale();
  if (!request) return null;

  const unit = request.unit ?? "";
  const withUnit = (qty: number) => `${formatQty(qty)} ${unit}`.trim();
  const partlyBought = request.remainingQuantity < request.requestedQuantity;
  const neededBy = parseNeededBy(request.neededBy);
  const budgetLeft =
    request.remainingBudget != null && request.approvedBudget != null && request.remainingBudget !== request.approvedBudget;

  const rows: { label: string; value: string }[] = [
    {
      label: t("bom.aria_quantity"),
      value: partlyBought
        ? `${withUnit(request.requestedQuantity)} · ${t("rd.left_to_buy", { qty: withUnit(request.remainingQuantity) })}`
        : withUnit(request.requestedQuantity),
    },
    {
      label: t("rd.approved_budget"),
      value: budgetLeft
        ? `${formatPeso(request.approvedBudget)} · ${t("rd.budget_left", { amount: formatPeso(request.remainingBudget) })}`
        : formatPeso(request.approvedBudget),
    },
    { label: t("tq.pref_vendor"), value: request.vendorName || t("rd.any_store") },
    {
      label: t("tq.needed_by"),
      value: neededBy
        ? neededBy.toLocaleDateString(intlLocale, { month: "short", day: "numeric", year: "numeric" })
        : t("tq.not_given"),
    },
    { label: t("rd.requested_by"), value: request.requestedByName || "—" },
    { label: t("rd.approved_by"), value: request.approvedByName || "—" },
  ];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t("pd.close")} />
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title} accessibilityRole="header">{request.subject}</Text>
        <Text style={styles.project} numberOfLines={2}>{request.projectName}</Text>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          {rows.map((row) => (
            <View key={row.label} style={styles.row}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.value}>{row.value}</Text>
            </View>
          ))}
          {request.description ? (
            <View style={styles.note}>
              <Text style={styles.label}>{t("rd.note")}</Text>
              <Text style={styles.noteText}>{request.description}</Text>
            </View>
          ) : null}
          {!canSnap ? <Text style={styles.hint}>{t("rd.sm_hint")}</Text> : null}
        </ScrollView>

        <View style={styles.actions}>
          {canSnap ? <AppButton label={t("rd.snap_for_this")} onPress={() => onSnap(request)} /> : null}
          <AppButton label={t("pd.close")} variant="secondary" onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { backgroundColor: COLORS.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 8, maxHeight: "80%" },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border, marginBottom: 10 },
  title: { fontSize: 18, fontFamily: FONT.extrabold, color: COLORS.heading },
  project: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 2 },
  body: { flexGrow: 0, marginTop: 12 },
  bodyContent: { gap: 10, paddingBottom: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingBottom: 10 },
  label: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted },
  value: { flex: 1, textAlign: "right", fontSize: 14, fontFamily: FONT.bold, color: COLORS.heading },
  note: { gap: 4 },
  noteText: { fontSize: 14, fontFamily: FONT.regular, color: COLORS.heading, lineHeight: 20 },
  hint: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted, lineHeight: 18 },
  actions: { gap: 10, paddingTop: 10, paddingBottom: 12 },
});
