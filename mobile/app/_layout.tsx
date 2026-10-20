import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Stack, router, useRootNavigationState } from "expo-router";

import { ExpenseDraftProvider } from "@/lib/expense-draft-context";
import { NetworkProvider } from "@/lib/sync/network-context";
import { OfflineBanner } from "@/components/offline-banner";
import { NotificationToast } from "@/components/notification-toast";
import { nextRouteAfterLogin, restoreSession } from "@/lib/auth";
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/plus-jakarta-sans";

export default function RootLayout() {
  // Redesigned screens use Plus Jakarta Sans (see FONT in constants/expense-flow-colors).
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  // Offline-first: bring back the saved sign-in before any screen checks it,
  // so the app opens straight to your work even with no connection.
  const [restored] = useState(() => restoreSession());
  // A cold start opens "/", which lands on the Purchaser home. With a saved
  // sign-in, send each role to its own home once (a Site Manager to their
  // tasks), the same place signing in would have taken them.
  const navReady = !!useRootNavigationState()?.key;
  const sentHome = useRef(false);
  useEffect(() => {
    if (!navReady || !restored || sentHome.current) return;
    sentHome.current = true;
    router.replace(nextRouteAfterLogin(restored.user));
  }, [navReady, restored]);
  // Wait for the fonts. If they fail to load, carry on with the system font.
  if (!fontsLoaded && !fontError) return null;

  return (
    <ExpenseDraftProvider>
      <NetworkProvider>
        <View style={{ flex: 1 }}>
          <OfflineBanner />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="expense" />
            <Stack.Screen name="oauth/callback" />
            <Stack.Screen name="terms" options={{ gestureEnabled: false }} />
          </Stack>
          <NotificationToast />
        </View>
      </NetworkProvider>
    </ExpenseDraftProvider>
  );
}