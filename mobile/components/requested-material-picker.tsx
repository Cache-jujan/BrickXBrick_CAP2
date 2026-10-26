// requested-material-picker.tsx — bottom-sheet list of the materials the
// Site Managers requested (open Material Request tickets), so the Purchaser
// can name a line item from the ticket instead of typing it or trusting OCR.
//
// It opens already narrowed to the requests that look like the scanned line, and has
// a search box for everything else.

import React, { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { searchRequests, suggestRequests } from "@/lib/request-search";
import { useLocale } from "@/lib/i18n-context";

export type RequestedMaterial = {
  key: string;
  name: string;
  detail: string;
  bomItemID: string | null;
  projectName?: string;
  vendorName?: string | null;
  subject?: string;
};

type Props = {
  visible: boolean;
  materials: RequestedMaterial[];
  /** What the receipt line says (the scanned text, else the typed name). Used to suggest requests. */
  lineText?: string;
  onSelect: (material: RequestedMaterial) => void;
  onClose: () => void;
};

export function RequestedMaterialPicker({ visible, materials, lineText = "", onSelect, onClose }: Props) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const suggested = useMemo(() => suggestRequests(lineText, materials, (m: RequestedMaterial) => m.name), [lineText, materials]);
  const typing = query.trim().length > 0;
  const data: RequestedMaterial[] = typing
    ? searchRequests(query, materials, (m: RequestedMaterial) => [m.name, m.subject, m.vendorName, m.projectName].join(" "))
    : showAll || !suggested.matched
      ? materials
      : suggested.requests;

  function close() {
    setQuery("");
    setShowAll(false);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel={t("rv.close_list")} />
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <Text style={styles.title}>{t("rv.requested_materials")}</Text>
        <Text style={styles.subtitle}>{t("rv.from_sm")}</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("rv.search_hint")}
          placeholderTextColor={COLORS.muted}
          style={styles.search}
          autoCorrect={false}
          returnKeyType="search"
        />
        {!typing && suggested.matched && !showAll ? (
          <View style={styles.hintRow}>
            <Text style={styles.hint} numberOfLines={1}>{t("rv.suggested_for", { line: lineText })}</Text>
            <Pressable onPress={() => setShowAll(true)} accessibilityRole="button" style={styles.hintLink}>
              <Text style={styles.hintLinkText}>{t("rv.show_all")}</Text>
            </Pressable>
          </View>
        ) : null}
        <FlatList
          data={data}
          keyExtractor={(m) => m.key}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={styles.hint}>{t("rv.none")}</Text>}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => { onSelect(item); close(); }}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${item.detail}`}
            >
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.detail}>{item.detail}</Text>
            </Pressable>
          )}
        />
        <Pressable onPress={close} style={styles.cancel} accessibilityRole="button">
          <Text style={styles.cancelText}>{t("common.cancel")}</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: COLORS.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, paddingTop: 16, maxHeight: "80%" },
  title: { fontSize: 16, fontFamily: FONT.bold, color: COLORS.heading },
  subtitle: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 2, marginBottom: 10 },
  search: { minHeight: MIN_TAP, borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 12, paddingHorizontal: 12, fontSize: 14, fontFamily: FONT.regular, color: COLORS.heading, backgroundColor: COLORS.bg },
  hintRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 },
  hint: { flex: 1, fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, paddingVertical: 8 },
  hintLink: { minHeight: MIN_TAP - 8, justifyContent: "center" },
  hintLinkText: { fontSize: 12, fontFamily: FONT.bold, color: COLORS.primary },
  list: { flexGrow: 0, marginTop: 4 },
  row: { minHeight: 44, justifyContent: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  rowPressed: { backgroundColor: COLORS.bg },
  name: { fontSize: 14, fontFamily: FONT.semibold, color: COLORS.heading },
  detail: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 2 },
  cancel: { alignItems: "center", paddingVertical: 14 },
  cancelText: { fontSize: 14, fontFamily: FONT.semibold, color: COLORS.primary },
});
