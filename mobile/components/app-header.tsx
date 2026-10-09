import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { IconSymbol } from "@/components/ui/icon-symbol";

const COLORS = {
  bg: "#F8F1E8",
  ink: "#1A1A1A",
  border: "#EDE6D9",
};

// Brand on the left, gear on the right. Logout lives only in Settings so it
// can't be tapped by accident from the home screen.
export function AppHeader() {
  return (
    <View style={styles.bar}>
      <Text style={styles.brand} numberOfLines={1}>
        BrickXBrick
      </Text>

      <Pressable
        style={styles.gear}
        onPress={() => router.push("/settings")}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Open settings"
      >
        <IconSymbol name="gearshape.fill" size={22} color={COLORS.ink} />
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
  brand: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.ink,
  },
  gear: {
    padding: 4,
  },
});
