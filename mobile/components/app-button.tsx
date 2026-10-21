import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";

export type ButtonVariant = "primary" | "secondary" | "destructive";

const LOOK: Record<ButtonVariant, { bg: string; border: string; text: string }> = {
  primary: { bg: COLORS.primary, border: COLORS.primary, text: "#FFFFFF" },
  secondary: { bg: COLORS.card, border: COLORS.primary, text: COLORS.primary },
  destructive: { bg: COLORS.card, border: COLORS.errorText, text: COLORS.errorText },
};

type Props = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  // Fill the row (default) or hug the label.
  fit?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

// One button for every screen: 48px tall, same radius, clear disabled and
// loading states. A loading button ignores taps so it cannot double-submit.
export function AppButton({ label, onPress, variant = "primary", loading, disabled, fit, style, accessibilityLabel }: Props) {
  const look = LOOK[variant];
  const off = !!disabled || !!loading;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy: !!loading }}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: look.bg, borderColor: look.border },
        fit ? styles.fit : styles.full,
        off && styles.off,
        pressed && !off && styles.pressed,
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={look.text} /> : null}
      <Text style={[styles.text, { color: look.text }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", borderRadius: 14, borderWidth: 1.5, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: MIN_TAP + 4, paddingHorizontal: 18 },
  full: { alignSelf: "stretch" },
  fit: { alignSelf: "flex-start" },
  off: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  text: { fontFamily: FONT.bold, fontSize: 14 },
});
