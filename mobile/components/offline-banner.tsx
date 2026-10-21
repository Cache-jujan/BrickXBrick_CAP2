import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useNetwork } from "@/lib/sync/network-context";
import { bannerState, SENT_SHOW_MS } from "@/lib/sync/messages";
import { COLORS, FONT } from "@/constants/expense-flow-colors";

const TONES = {
  offline: { bg: COLORS.errorBorder, icon: "wifi.slash" },
  waiting: { bg: COLORS.amberText, icon: "clock.fill" },
  sending: { bg: COLORS.infoText, icon: "arrow.triangle.2.circlepath" },
  sent: { bg: COLORS.success, icon: "checkmark.circle.fill" },
} as const;

// 10.2 — one strip at the top of every screen for the offline queue:
// offline (with the queued count), sending, waiting to retry, or all sent.
// The rule for which one shows lives in lib/sync/messages.js (bannerState).
export function OfflineBanner() {
  const { isOnline, pendingCount, syncing, lastSync } = useNetwork();
  const insets = useSafeAreaInsets();
  const [, setTick] = useState(0);

  // Re-render once the "all sent" strip has been up long enough, so it hides.
  useEffect(() => {
    if (!lastSync) return;
    const timer = setTimeout(() => setTick((t) => t + 1), SENT_SHOW_MS + 100);
    return () => clearTimeout(timer);
  }, [lastSync]);

  const state = bannerState({ isOnline, pendingCount, syncing, lastSync, now: Date.now() });
  if (!state) return null;
  const tone = TONES[state.tone as keyof typeof TONES];

  return (
    <View
      style={[styles.banner, { backgroundColor: tone.bg, paddingTop: insets.top + 6 }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <IconSymbol name={tone.icon} size={16} color="#FFF" />
      <Text style={styles.text}>{state.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingBottom: 6,
    paddingHorizontal: 16,
  },
  text: { color: "#FFF", fontSize: 12, fontFamily: FONT.bold, flexShrink: 1 },
});
