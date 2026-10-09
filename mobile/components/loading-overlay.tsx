import { ActivityIndicator, Modal, StyleSheet, Text, View } from "react-native";

import { COLORS } from "@/constants/expense-flow-colors";

// Full-screen blocking overlay for slow steps (OCR scan, submit). Being a
// Modal, it also swallows taps, so nothing underneath can be pressed twice.
export function LoadingOverlay({ visible, message, detail }: { visible: boolean; message: string; detail?: string }) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.panel} accessibilityRole="progressbar" accessibilityLabel={message}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.message}>{message}</Text>
          {detail ? <Text style={styles.detail}>{detail}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  panel: { backgroundColor: COLORS.card, borderRadius: 18, paddingVertical: 24, paddingHorizontal: 28, alignItems: "center", gap: 12, minWidth: 220, maxWidth: 320 },
  message: { fontSize: 16, fontWeight: "700", color: COLORS.heading, textAlign: "center" },
  detail: { fontSize: 13, color: COLORS.muted, textAlign: "center" },
});
