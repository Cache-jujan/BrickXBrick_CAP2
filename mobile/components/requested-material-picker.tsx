// requested-material-picker.tsx — bottom-sheet list of the materials the
// Site Managers requested (open Material Request tickets), so the Purchaser
// can name a line item from the ticket instead of typing it or trusting OCR.

import React from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { COLORS } from "@/constants/expense-flow-colors";

export type RequestedMaterial = {
  key: string;
  name: string;
  detail: string;
};

type Props = {
  visible: boolean;
  materials: RequestedMaterial[];
  onSelect: (material: RequestedMaterial) => void;
  onClose: () => void;
};

export function RequestedMaterialPicker({ visible, materials, onSelect, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close the list" />
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <Text style={styles.title}>Requested materials</Text>
        <Text style={styles.subtitle}>From the Site Managers&apos; material requests.</Text>
        <FlatList
          data={materials}
          keyExtractor={(m) => m.key}
          style={styles.list}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onSelect(item)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${item.detail}`}
            >
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.detail}>{item.detail}</Text>
            </Pressable>
          )}
        />
        <Pressable onPress={onClose} style={styles.cancel} accessibilityRole="button">
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: COLORS.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, paddingTop: 16, maxHeight: "70%" },
  title: { fontSize: 16, fontWeight: "700", color: COLORS.heading },
  subtitle: { fontSize: 12, color: COLORS.muted, marginTop: 2, marginBottom: 10 },
  list: { flexGrow: 0 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  rowPressed: { backgroundColor: COLORS.bg },
  name: { fontSize: 14, fontWeight: "600", color: COLORS.heading },
  detail: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  cancel: { alignItems: "center", paddingVertical: 14 },
  cancelText: { fontSize: 14, fontWeight: "600", color: COLORS.primary },
});
