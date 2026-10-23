import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
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

// Which strip (if any) is showing right now. The rule lives in
// lib/sync/messages.js (bannerState); this only adds the timer that hides the
// "all sent" strip once it has been up long enough.
function useBannerState() {
  const { isOnline, pendingCount, syncing, lastSync } = useNetwork();
  // The clock is state, not Date.now() in the render. The React Compiler keeps
  // the last result of a call whose inputs have not changed, so a Date.now()
  // inside render is read once and the "all sent" strip never hid.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!lastSync) return;
    setNow(Date.now());
    const timer = setTimeout(() => setNow(Date.now()), SENT_SHOW_MS + 100);
    return () => clearTimeout(timer);
  }, [lastSync]);

  return bannerState({ isOnline, pendingCount, syncing, lastSync, now });
}

// Lets screens know whether the strip is showing and how tall it is. While it
// shows it already clears the status bar, so a screen under it must not add
// its own top inset (hooks/use-screen-insets.ts) and the keyboard wrapper does
// not need it.
type Strip = { visible: boolean; height: number; setHeight: (height: number) => void };
const StripContext = createContext<Strip>({ visible: false, height: 0, setHeight: () => {} });

export function OfflineStripProvider({ children }: { children: React.ReactNode }) {
  const state = useBannerState();
  const [height, setHeight] = useState(0);
  const value = useMemo<Strip>(() => ({ visible: !!state, height: state ? height : 0, setHeight }), [state, height]);
  return <StripContext.Provider value={value}>{children}</StripContext.Provider>;
}

export function useOfflineStrip() {
  const { visible, height } = useContext(StripContext);
  return { visible, height };
}

// 10.2 — one strip at the top of every screen for the offline queue:
// offline (with the queued count), sending, waiting to retry, or all sent.
export function OfflineBanner() {
  const state = useBannerState();
  const insets = useSafeAreaInsets();
  const { setHeight } = useContext(StripContext);

  if (!state) return null;
  const tone = TONES[state.tone as keyof typeof TONES];

  return (
    <View
      style={[styles.banner, { backgroundColor: tone.bg, paddingTop: insets.top + 6 }]}
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
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
