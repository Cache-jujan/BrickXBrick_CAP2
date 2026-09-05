import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Tabs } from "expo-router";

import { AppHeader } from "@/./components/app-header";
import { IconSymbol } from "@/components/ui/icon-symbol";

const BG = "#F8F1E8";
const ACTIVE_COLOR = "#1A1A1A";
const INACTIVE_COLOR = "#A79E8C";

export default function TabLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* edges=["top"] only pads for the status bar — the tab bar below
         already handles its own bottom safe-area inset. */}
      <SafeAreaView edges={["top"]} style={{ backgroundColor: BG }}>
        <AppHeader
          onLogout={() => {
            // TODO: wire this to the real logout call once we know what it is
            // (e.g. POST /api/auth/logout, or clearing a stored session token).
            console.log("Logout tapped — not wired up yet");
          }}
        />
      </SafeAreaView>

      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: ACTIVE_COLOR,
          tabBarInactiveTintColor: INACTIVE_COLOR,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Capture",
            tabBarIcon: ({ color, size }) => (
              <IconSymbol name="camera.fill" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: "History",
            tabBarIcon: ({ color, size }) => (
              <IconSymbol name="clock.arrow.circlepath" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="insights"
          options={{
            title: "Insights",
            tabBarIcon: ({ color, size }) => (
              <IconSymbol name="chart.bar.fill" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: "Settings",
            tabBarIcon: ({ color, size }) => (
              <IconSymbol name="gearshape.fill" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}