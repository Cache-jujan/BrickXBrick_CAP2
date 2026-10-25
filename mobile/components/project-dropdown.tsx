import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";

type Option = { id: string | null; label: string };

type Props = {
  /** Small label above the button, e.g. "Filter by project". */
  label: string;
  /** First option, used when nothing is picked (id null). */
  allLabel: string;
  options: { id: string; label: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
};

// One button that shows the current project and opens a short list under it. One line
// tall when closed, so it costs far less room than a row of chips.
export function ProjectDropdown({ label, allLabel, options, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const all: Option[] = [{ id: null, label: allLabel }, ...options];
  const current = all.find((o) => o.id === value) ?? all[0];

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current.label}`}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.flex}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.value} numberOfLines={1}>{current.label}</Text>
        </View>
        <IconSymbol name={open ? "chevron.down" : "chevron.right"} size={18} color={COLORS.muted} />
      </Pressable>

      {open ? (
        <View style={styles.list}>
          {all.map((option) => {
            const on = option.id === (value ?? null);
            const isAll = option.id === null;
            return (
              <Pressable
                key={option.id ?? "all"}
                onPress={() => { onChange(option.id); setOpen(false); }}
                style={({ pressed }) => [styles.row, isAll && styles.rowAll, on && styles.rowOn, pressed && { opacity: 0.85 }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                {isAll ? <IconSymbol name="folder.fill" size={18} color={COLORS.primary} /> : null}
                <Text style={[styles.rowText, isAll && styles.rowTextAll, on && styles.rowTextOn]} numberOfLines={2}>{option.label}</Text>
                {on ? <IconSymbol name="checkmark.circle.fill" size={18} color={COLORS.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { gap: 6 },
  button: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: MIN_TAP + 4, backgroundColor: COLORS.card, borderRadius: 14, borderWidth: 1, borderColor: COLORS.inputBorder, paddingHorizontal: 14, paddingVertical: 8 },
  label: { fontSize: 11, fontFamily: FONT.semibold, color: COLORS.muted },
  value: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.heading },
  list: { backgroundColor: COLORS.card, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: MIN_TAP, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: COLORS.border },
  rowAll: { borderTopWidth: 0, borderBottomWidth: 2, borderBottomColor: COLORS.primary },
  rowTextAll: { fontFamily: FONT.extrabold, color: COLORS.primary },
  rowOn: { backgroundColor: COLORS.primaryTint },
  rowText: { flex: 1, fontSize: 14, fontFamily: FONT.semibold, color: COLORS.heading },
  rowTextOn: { color: COLORS.primaryTintText, fontFamily: FONT.bold },
});
