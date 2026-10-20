import { Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { COLORS, MIN_TAP } from "@/constants/expense-flow-colors";

type Props = {
  // Replaces the default "go back".
  onPress?: () => void;
  // Where to go when there is nothing to go back to (a deep link, a cold start).
  fallback?: string;
  color?: string;
};

// The one back button for every pushed screen. It is a fixed 44 px square, so
// it stays easy to tap on any phone size, and it never traps the user: with no
// history it goes to the fallback instead of doing nothing.
export function BackButton({ onPress, fallback = "/", color = COLORS.heading }: Props) {
  function goBack() {
    if (onPress) return onPress();
    if (router.canGoBack()) router.back();
    else router.replace(fallback as never);
  }

  return (
    <Pressable
      onPress={goBack}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <IconSymbol name="chevron.left" size={28} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: MIN_TAP, height: MIN_TAP, alignItems: "center", justifyContent: "center", borderRadius: MIN_TAP / 2 },
  pressed: { backgroundColor: "rgba(0,0,0,0.06)" },
});
