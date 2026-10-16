import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useNetwork } from "@/lib/sync/network-context";

// 10.2 — red banner while offline, with the number of queued entries
// (expenses and task updates together).
export function OfflineBanner() {
  const { isOnline, pendingCount } = useNetwork();
  const insets = useSafeAreaInsets();

  if (isOnline) return null;

  return (
    <View style={[styles.banner, { paddingTop: insets.top + 6 }]} accessibilityRole="alert">
      <IconSymbol name="wifi.slash" size={16} color="#FFF" />
      <Text style={styles.text}>
        You're offline{pendingCount > 0 ? ` · ${pendingCount} queued` : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#C62828",
    paddingBottom: 6,
    paddingHorizontal: 16,
  },
  text: { color: "#FFF", fontSize: 12, fontWeight: "700" },
});