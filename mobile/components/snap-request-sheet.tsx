import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import type { OpenRequest } from "@/lib/api";
import { formatPeso } from "@/lib/money";
import { useLocale } from "@/lib/i18n-context";

type Props = {
  visible: boolean;
  requests: OpenRequest[];
  /** One receipt for one request: the normal case. */
  onPick: (request: OpenRequest) => void;
  /** The exception: one receipt that pays for several requests. */
  onSeveral: () => void;
  onClose: () => void;
};

// Asks "which request is this receipt for?" before the photo. A receipt belongs to one request;
// covering several is the exception, so it is the quieter choice at the bottom.
export function SnapRequestSheet({ visible, requests, onPick, onSeveral, onClose }: Props) {
  const { t } = useLocale();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t("common.cancel")} />
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>{t("tb.snap_which_request")}</Text>
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {requests.map((request) => (
            <Pressable
              key={request.ticketID}
              onPress={() => onPick(request)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
            >
              <View style={styles.flex}>
                <Text style={styles.rowText} numberOfLines={2}>{request.subject}</Text>
                <Text style={styles.rowHelp} numberOfLines={1}>
                  {request.projectName}{request.remainingBudget != null ? ` · ${t("bd.left", { remaining: formatPeso(request.remainingBudget) })}` : ""}
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={COLORS.muted} />
            </Pressable>
          ))}
        </ScrollView>
        <Pressable onPress={onSeveral} style={({ pressed }) => [styles.several, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <Text style={styles.severalText}>{t("tb.snap_several")}</Text>
          <Text style={styles.rowHelp}>{t("tb.snap_several_help")}</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { backgroundColor: COLORS.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 8, maxHeight: "75%" },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border, marginBottom: 10 },
  title: { fontSize: 17, fontFamily: FONT.extrabold, color: COLORS.heading, marginBottom: 8 },
  list: { flexGrow: 0 },
  listContent: { gap: 8, paddingBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: MIN_TAP + 8, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: COLORS.card },
  rowText: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.heading },
  rowHelp: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 1 },
  several: { minHeight: MIN_TAP, paddingVertical: 12, paddingHorizontal: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  severalText: { fontSize: 14, fontFamily: FONT.semibold, color: COLORS.primary },
});
