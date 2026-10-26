import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useLocale } from "@/lib/i18n-context";

type Props = {
  visible: boolean;
  projects: { id: string; name: string }[];
  /** A project was chosen: scan for that project only. */
  onPick: (project: { id: string; name: string }) => void;
  /** "Multiple projects": scan, then match the receipt against every project. */
  onMultiple: () => void;
  onClose: () => void;
};

// Asks "which project is this receipt for?" once the photo is taken (app/expense/capture.tsx).
// The app never guesses the project; it only skips this when the user has a single one.
export function SnapProjectSheet({ visible, projects, onPick, onMultiple, onClose }: Props) {
  const { t } = useLocale();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t("common.cancel")} />
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>{t("tb.which_project")}</Text>
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {projects.map((project) => (
            <Pressable
              key={project.id}
              onPress={() => onPick(project)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
            >
              <View style={styles.radio} />
              <Text style={styles.rowText} numberOfLines={2}>{project.name}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={onMultiple}
            style={({ pressed }) => [styles.row, styles.rowMulti, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
          >
            <IconSymbol name="folder.fill" size={20} color={COLORS.primary} />
            <View style={styles.flex}>
              <Text style={styles.rowText}>{t("tb.multiple_projects")}</Text>
              <Text style={styles.rowHelp}>{t("tb.multiple_projects_help")}</Text>
            </View>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { backgroundColor: COLORS.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 8, maxHeight: "70%" },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border, marginBottom: 10 },
  title: { fontSize: 17, fontFamily: FONT.extrabold, color: COLORS.heading, marginBottom: 8 },
  list: { flexGrow: 0 },
  listContent: { gap: 8, paddingBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: MIN_TAP + 8, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: COLORS.card },
  rowMulti: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryTint },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: COLORS.inputBorder },
  rowText: { flex: 1, fontSize: 15, fontFamily: FONT.bold, color: COLORS.heading },
  rowHelp: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted },
});
