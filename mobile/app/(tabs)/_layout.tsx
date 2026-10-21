import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router, Tabs } from "expo-router";

import { AppHeader } from "@/components/app-header";
import { SmBottomBar } from "@/components/sm-bottom-bar";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { COLORS, FONT } from "@/constants/expense-flow-colors";
import { getSession } from "@/lib/auth";

// The Purchaser gets Requests / Expenses / Account tabs. A Site Manager landing
// here keeps the single screen with no tab bar. Account opens Settings (and
// logout) at /settings.
// The (tabs) folder name is kept because index.tsx, login.tsx and the OAuth
// callback all redirect to "/(tabs)".
export default function TabLayout() {
  const session = getSession();
  if (!session || !["Purchaser", "Site Manager"].includes(session.user.role)) return <Redirect href="/login" />;
  const isPurchaser = session.user.role === "Purchaser";

  return (
    <View style={{ flex: 1, backgroundColor: isPurchaser ? COLORS.bg : COLORS.bgWarm }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: COLORS.card }}>
        <AppHeader />
      </SafeAreaView>

      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: isPurchaser
            ? { backgroundColor: COLORS.card, borderTopColor: COLORS.border, minHeight: 56 }
            : { display: "none" },
          tabBarActiveTintColor: COLORS.primary,
          tabBarInactiveTintColor: COLORS.muted,
          tabBarLabelStyle: { fontFamily: FONT.semibold, fontSize: 11 },
          tabBarItemStyle: { minHeight: 48 },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Requests",
            tabBarIcon: ({ color }) => <IconSymbol name="list.clipboard.fill" size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="expenses"
          options={{
            title: "Expenses",
            href: isPurchaser ? undefined : null,
            tabBarIcon: ({ color }) => <IconSymbol name="receipt" size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="account"
          options={{
            title: "Account",
            href: isPurchaser ? undefined : null,
            tabBarIcon: ({ color }) => <IconSymbol name="person.crop.circle" size={24} color={color} />,
          }}
          listeners={{
            // Account is not a screen of its own: open Settings instead.
            tabPress: (event) => {
              event.preventDefault();
              router.push("/settings");
            },
          }}
        />
      </Tabs>
      {/* Site Manager: the same bottom bar as Tasks / Requests / Settings. */}
      {isPurchaser ? null : <SmBottomBar />}
    </View>
  );
}
