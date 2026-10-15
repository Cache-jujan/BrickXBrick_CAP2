import { View } from "react-native";
import { Stack } from "expo-router";

import { ExpenseDraftProvider } from "@/lib/expense-draft-context";
import { NetworkProvider } from "@/lib/sync/network-context";
import { OfflineBanner } from "@/components/offline-banner";

export default function RootLayout() {
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