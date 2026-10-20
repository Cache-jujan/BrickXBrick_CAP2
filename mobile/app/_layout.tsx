import { useState } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";

import { ExpenseDraftProvider } from "@/lib/expense-draft-context";
import { NetworkProvider } from "@/lib/sync/network-context";
import { OfflineBanner } from "@/components/offline-banner";
import { restoreSession } from "@/lib/auth";

export default function RootLayout() {
  // Offline-first: bring back the saved sign-in before any screen checks it,
  // so the app opens straight to your work even with no connection.
  useState(() => restoreSession());
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
        </View>
      </NetworkProvider>
    </ExpenseDraftProvider>
  );
}