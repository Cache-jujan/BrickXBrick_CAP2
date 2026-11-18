import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { COLORS, FONT } from "@/constants/expense-flow-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";

type Props = {
  /** The project's name(s). */
  name: string;
  /** Small caption above the name, e.g. "Project". */
  label?: string;
};

// Which project a receipt belongs to, for a receipt snapped from a project on To Buy.
// Shown on every step of that flow, so the Purchaser can always see where it is going.
export function ProjectPill({ name, label }: Props) {
  return (
    <View style={styles.pill} accessibilityRole="text" accessibilityLabel={label ? `${label}: ${name}` : name}>
      <View style={styles.icon}>
        <IconSymbol name="folder.fill" size={18} color={COLORS.primary} />
      </View>
      <View style={styles.body}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <Text style={styles.name} numberOfLines={2}>{name}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: COLORS.primaryTint, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 10 },
  icon: { width: 32, height: 32, borderRadius: 10, backgroundColor: COLORS.card, alignItems: "center", justifyContent: "center" },
  body: { flex: 1 },
  label: { fontSize: 11, fontFamily: FONT.semibold, color: COLORS.primaryTintText },
  name: { fontSize: 15, fontFamily: FONT.extrabold, color: COLORS.primaryTintText },
});
