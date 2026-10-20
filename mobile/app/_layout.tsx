import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Stack, router, useRootNavigationState } from "expo-router";

import { ExpenseDraftProvider } from "@/lib/expense-draft-context";
import { NetworkProvider } from "@/lib/sync/network-context";
import { OfflineBanner } from "@/components/offline-banner";
import { NotificationToast } from "@/components/notification-toast";
import { nextRouteAfterLogin, restoreSession } from "@/lib/auth";

export default function RootLayout() {
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