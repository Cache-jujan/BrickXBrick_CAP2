import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { AppButton } from "@/components/app-button";
import { BottomSheet } from "@/components/bottom-sheet";
import { requestBudgetAdjustment } from "@/lib/api";
import { formatPeso } from "@/lib/money";
import { useLocale } from "@/lib/i18n-context";

/** The reasons the Purchaser can tap. The codes are the ones the server accepts (backend/src/lib/budgetAdjustment.js). */
export const ADJUSTMENT_REASONS = [
  { code: "supplier_price_increase", labelKey: "ck.adj_supplier_price_increase" },
  { code: "more_quantity", labelKey: "ck.adj_more_quantity" },
  { code: "extra_materials", labelKey: "ck.adj_extra_materials" },
  { code: "delivery_fees", labelKey: "ck.adj_delivery_fees" },
  { code: "estimate_too_low", labelKey: "ck.adj_estimate_too_low" },
  { code: "other", labelKey: "ck.adj_other" },
] as const;

type Props = {
  visible: boolean;
  /** The request that is over its budget and how much more it needs, as the server worked them out. */
  target: { ticketID: string; material: string; project: string; over: string } | null;
  onClose: () => void;
  /** The ask went through (or was already sent). */
  onSent: (ticketID: string) => void;
};

// "Request budget adjustment": the Purchaser taps a reason (and may add a note), and the ask goes to the Project
// Manager as a ticket. Approving it raises the request's approved budget; the purchase stays blocked until then.
export function BudgetAdjustmentSheet({ visible, target, onClose, onSent }: Props) {
  const { t } = useLocale();
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setReason(null);
    setNote("");
    setProblem(null);
  }, [visible, target?.ticketID]);

  // "Other" must say what the reason is; the others need nothing more than the tap.
  const needsNote = reason === "other";
  const canSend = !!target && !!reason && (!needsNote || note.trim().length > 0) && !busy;

  async function send() {
    if (!target || !reason || !canSend) return;
    setBusy(true);
    setProblem(null);
    try {
      await requestBudgetAdjustment({ ticketID: target.ticketID, requestedAmount: Number(target.over), reasonCode: reason, note: note.trim() || undefined });
      onSent(target.ticketID);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      // 409 = one is already waiting for this request: treat it as sent.
      if (status === 409) return onSent(target.ticketID);
      setProblem(err instanceof Error && status && status < 500 ? err.message : t("ck.adjust_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={busy ? () => {} : onClose}
      title={t("ck.adjust_title")}
      top={
        target ? (
          <Text style={styles.summary}>{t("ck.adjust_summary", { material: target.material, project: target.project, over: formatPeso(target.over) })}</Text>
        ) : null
      }
      footer={
        <View style={styles.footer}>
          {problem ? <Text style={styles.problem} accessibilityRole="alert">{problem}</Text> : null}
          <AppButton label={t("ck.adjust_send")} onPress={send} disabled={!canSend} loading={busy} />
        </View>
      }
    >
      <Text style={styles.question}>{t("ck.adjust_pick")}</Text>
      {ADJUSTMENT_REASONS.map((r) => {
        const on = reason === r.code;
        return (
          <Pressable
            key={r.code}
            onPress={() => { setReason(r.code); setProblem(null); }}
            style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && { opacity: 0.85 }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
            <Text style={[styles.optionText, on && styles.optionTextOn]}>{t(r.labelKey)}</Text>
          </Pressable>
        );
      })}
      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        placeholder={needsNote ? t("ck.adjust_note_required") : t("ck.adjust_note_hint")}
        placeholderTextColor={COLORS.muted}
        maxLength={300}
        multiline
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  summary: { fontSize: 14, fontFamily: FONT.semibold, color: COLORS.heading, lineHeight: 20 },
  question: { fontSize: 13, fontFamily: FONT.bold, color: COLORS.muted },
  option: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: MIN_TAP + 8, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: COLORS.card },
  optionOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryTint },
  optionText: { flex: 1, fontSize: 15, fontFamily: FONT.semibold, color: COLORS.heading },
  optionTextOn: { fontFamily: FONT.bold, color: COLORS.primaryTintText },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: COLORS.inputBorder, alignItems: "center", justifyContent: "center" },
  radioOn: { borderColor: COLORS.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.primary },
  input: { minHeight: 64, borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: FONT.regular, color: COLORS.heading, backgroundColor: COLORS.card, textAlignVertical: "top" },
  footer: { gap: 8, paddingTop: 2 },
  problem: { fontSize: 13, fontFamily: FONT.semibold, color: COLORS.errorText },
});
