import { Tabs } from "expo-router";

import { IconSymbol } from "@/components/ui/icon-symbol";

// Matches the ink/muted tokens used across the app for a consistent brand feel.
const ACTIVE_COLOR = "#1A1A1A";
const INACTIVE_COLOR = "#A79E8C";

export default function TabLayout() {
  return (
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
  );
}