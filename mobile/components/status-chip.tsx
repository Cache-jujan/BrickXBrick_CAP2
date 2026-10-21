import { StyleSheet, Text, View } from "react-native";

import { COLORS, FONT } from "@/constants/expense-flow-colors";

export type ChipTone = "primary" | "info" | "success" | "amber" | "error" | "neutral";

const TONES: Record<ChipTone, { fill: string; text: string }> = {
  primary: { fill: COLORS.primaryTint, text: COLORS.primaryTintText },
  info: { fill: COLORS.infoFill, text: COLORS.infoText },
  success: { fill: COLORS.successBg, text: COLORS.success },
  amber: { fill: COLORS.amberBannerFill, text: COLORS.amberText },
  error: { fill: COLORS.errorFill, text: COLORS.errorText },
  neutral: { fill: COLORS.bg, text: COLORS.muted },
};

// A small rounded label, e.g. "In progress", "Approved", "Split".
export function StatusChip({ label, tone = "neutral" }: { label: string; tone?: ChipTone }) {
  const { fill, text } = TONES[tone];
  return (
    <View style={[styles.chip, { backgroundColor: fill }]}>
      <Text style={[styles.text, { color: text }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  text: { fontSize: 11, fontFamily: FONT.bold },
});
