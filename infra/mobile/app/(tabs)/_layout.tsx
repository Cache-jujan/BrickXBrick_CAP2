import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, Tabs, router } from "expo-router";

import { AppHeader } from "@/components/app-header";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { getSession, logout } from "@/lib/auth";

const BG = "#F8F1E8";
const ACTIVE_COLOR = "#1A1A1A";
const INACTIVE_COLOR = "#A79E8C";

export default function TabLayout() {
  const session = getSession();
  if (!session || session.user.role !== "Purchaser") return <Redirect href="/login" />;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: BG }}>
        <AppHeader
          onLogout={() => {
            logout();
            router.replace("/login");
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
        <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color, size }) => <IconSymbol name="house.fill" size={size} color={color} /> }} />
        
        <Tabs.Screen
          name="history"
          options={{ title: "History", tabBarIcon: ({ color, size }) => <IconSymbol name="clock.arrow.circlepath" size={size} color={color} /> }}
        />
        <Tabs.Screen
          name="insights"
          options={{ title: "Insights", tabBarIcon: ({ color, size }) => <IconSymbol name="chart.bar.fill" size={size} color={color} /> }}
        />
        <Tabs.Screen
          name="settings"
          options={{ title: "Settings", tabBarIcon: ({ color, size }) => <IconSymbol name="gearshape.fill" size={size} color={color} /> }}
        />
      </Tabs>
    </View>
  );
}
