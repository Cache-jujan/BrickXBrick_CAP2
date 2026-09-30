import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { IconSymbol } from "@/components/ui/icon-symbol";

const COLORS = {
  bg: "#F8F1E8",
  ink: "#1A1A1A",
  border: "#EDE6D9",
  danger: "#C1121F",
};

type Props = {
  onLogout?: () => void;
};

export function AppHeader({ onLogout }: Props) {
  return (
    <View style={styles.bar}>
      <Pressable
        style={styles.side}
        onPress={() => router.replace("/")}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Go to Home"
      >
        <IconSymbol name="house.fill" size={18} color={COLORS.ink} />
        <Text style={styles.sideLabel}>Home</Text>
      </Pressable>

      <Text style={styles.brand} numberOfLines={1}>
        BrickXBrick
      </Text>

      <Pressable
        style={styles.side}
        onPress={onLogout}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Log out"
      >
        <Text style={[styles.sideLabel, styles.logoutLabel]}>Logout</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.bg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  side: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 70,
  },
  sideLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.ink,
  },
  logoutLabel: {
    color: COLORS.danger,
    textAlign: "right",
  },
  brand: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.ink,
  },
});