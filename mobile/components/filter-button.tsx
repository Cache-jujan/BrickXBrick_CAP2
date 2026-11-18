import React, { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useLocale } from "@/lib/i18n-context";

type Props = {
  /** Sheet title and the button's spoken name, e.g. "Filter by project". */
  label: string;
  /** First option, used when nothing is picked (id null). */
  allLabel: string;
  options: { id: string; label: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
};

// An icon-only button for the screen header. A dot on it says a filter is on; the choices
// open in a bottom sheet, so the list itself takes no room on the screen.
export function FilterButton({ label, allLabel, options, value, onChange }: Props) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const all = [{ id: null as string | null, label: allLabel }, ...options];
  const active = value !== null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.button, active && styles.buttonOn, pressed && { opacity: 0.8 }]}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${all.find((o) => o.id === value)?.label ?? allLabel}`}
        hitSlop={4}
      >
        <IconSymbol name="line.3.horizontal.decrease" size={22} color={active ? COLORS.primary : COLORS.heading} />
        {active ? <View style={styles.dot} /> : null}
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel={t("common.cancel")} />
        <SafeAreaView edges={["bottom"]} style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>{label}</Text>
          <ScrollView style={styles.list}>
            {all.map((option) => {
              const on = option.id === value;
              return (
                <Pressable
                  key={option.id ?? "all"}
                  onPress={() => { onChange(option.id); setOpen(false); }}
                  style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && { opacity: 0.85 }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.rowText, on && styles.rowTextOn]} numberOfLines={2}>{option.label}</Text>
                  {on ? <IconSymbol name="checkmark.circle.fill" size={20} color={COLORS.primary} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: { width: MIN_TAP, height: MIN_TAP, borderRadius: MIN_TAP / 2, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.inputBorder },
  buttonOn: { backgroundColor: COLORS.primaryTint, borderColor: COLORS.primary },
  dot: { position: "absolute", top: 8, right: 8, width: 9, height: 9, borderRadius: 5, backgroundColor: COLORS.errorText, borderWidth: 1.5, borderColor: COLORS.card },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { backgroundColor: COLORS.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 8, maxHeight: "70%" },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border, marginBottom: 10 },
  title: { fontSize: 17, fontFamily: FONT.extrabold, color: COLORS.heading, marginBottom: 6 },
  list: { flexGrow: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: MIN_TAP, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10 },
  rowOn: { backgroundColor: COLORS.primaryTint },
  rowText: { flex: 1, fontSize: 15, fontFamily: FONT.semibold, color: COLORS.heading },
  rowTextOn: { color: COLORS.primaryTintText, fontFamily: FONT.bold },
});
