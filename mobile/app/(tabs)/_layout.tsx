import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, Tabs } from "expo-router";

import { AppHeader } from "@/components/app-header";
import { getSession } from "@/lib/auth";

const BG = "#F8F1E8";

// The Purchaser home is a single screen. The tab bar is hidden; Settings
// (and logout) live behind the gear in the header at /settings.
// The (tabs) folder name is kept because index.tsx, login.tsx and the OAuth
// callback all redirect to "/(tabs)".
export default function TabLayout() {
  const session = getSession();
  if (!session || !["Purchaser", "Site Manager"].includes(session.user.role)) return <Redirect href="/login" />;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: BG }}>
        <AppHeader />
      </SafeAreaView>

      <Tabs screenOptions={{ headerShown: false, tabBarStyle: { display: "none" } }}>
        <Tabs.Screen name="index" options={{ title: "Home" }} />
      </Tabs>
    </View>
  );
}
