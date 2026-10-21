import { Platform, StatusBar } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useOfflineStrip } from "@/components/offline-banner";

// The one place that decides how far a screen must stay clear of the system
// bars. Every screen built on <Screen> uses it, so no screen adds its own
// top margin.
//
// Two things make the plain inset unreliable, and both caused the back button
// to sit under the status bar where taps are not delivered:
//  - on Android with edge-to-edge the inset can read 0 on the first frame, so
//    the status bar height is used as a floor;
//  - the offline strip at the top of the app already clears the status bar, so
//    while it is showing the screen below it needs no top inset of its own.
export function useScreenInsets() {
  const insets = useSafeAreaInsets();
  const strip = useOfflineStrip();
  const systemTop = Platform.OS === "android" ? Math.max(insets.top, StatusBar.currentHeight ?? 0) : insets.top;
  return { ...insets, top: strip.visible ? 0 : systemTop, stripHeight: strip.visible ? strip.height : 0 };
}
