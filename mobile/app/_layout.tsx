import { useEffect } from "react";
import { Stack } from "expo-router";
import NetInfo from "@react-native-community/netinfo";

import { initDb, getUnsyncedRecords, markSynced } from "@/lib/sync/db";
import { syncAllPending } from "@/lib/sync/sync";

export default function RootLayout() {
  useEffect(() => {
    initDb();

    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        syncAllPending(getUnsyncedRecords, markSynced);
      }
    });

    return () => unsubscribe();
  }, []);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="oauth/callback" />
    </Stack>
  );
}