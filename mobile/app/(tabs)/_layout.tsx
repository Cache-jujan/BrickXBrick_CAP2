import { useEffect } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, Tabs } from "expo-router";

import { MainHeader } from "@/components/main-header";
import { SmBottomBar } from "@/components/sm-bottom-bar";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { COLORS, FONT } from "@/constants/expense-flow-colors";
import { getSession } from "@/lib/auth";
import { loadMyExpenses, loadScans } from "@/lib/cached-api";
import { rejectedCount } from "@/lib/history-groups";
import { setRejectedBadge, useRejectedBadge } from "@/lib/history-badge";
import { setTurnInBadge, useTurnInBadge } from "@/lib/turnin-badge";
import { useLocale } from "@/lib/i18n-context";

// The Purchaser gets To Buy / Turn In / History; a Site Manager landing here gets the Receipt screen.
// Both use the same floating bottom bar (SmBottomBar), so the native tab bar is hidden.
// Settings (and logout) open from the avatar in the header.
// The (tabs) folder name is kept because index.tsx, login.tsx and the OAuth
// callback all redirect to "/(tabs)".
export default function TabLayout() {
  const { t } = useLocale();
  const session = getSession();
  const rejectedBadge = useRejectedBadge();
  const turnInBadge = useTurnInBadge();
  const isPurchaserSession = session?.user.role === "Purchaser";
  const isSiteManagerSession = session?.user.role === "Site Manager";
  // Load the counts up front so the badges show before the tabs are opened.
  // The Site Manager has History too (badge on the bottom bar) but no Turn In.
  useEffect(() => {
    if (!isPurchaserSession && !isSiteManagerSession) return;
    loadMyExpenses()
      .then((result) => setRejectedBadge(rejectedCount(result.data)))
      .catch(() => {});
    if (!isPurchaserSession) return;
    loadScans()
      .then((result) => setTurnInBadge(result.data.length))
      .catch(() => {});
  }, [isPurchaserSession, isSiteManagerSession]);
  if (!session || !["Purchaser", "Site Manager"].includes(session.user.role)) return <Redirect href="/login" />;
  const isPurchaser = session.user.role === "Purchaser";

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: COLORS.bg }}>
        <MainHeader />
      </SafeAreaView>

      <Tabs
        screenOptions={{
          headerShown: false,
          // Our own bar replaces the native one. All three tabs are built up front and kept (not rebuilt on every
          // visit), and a tab you left stops re-rendering, so switching is instant.
          lazy: false,
          freezeOnBlur: true,
          tabBarStyle: { display: "none" },
          tabBarActiveTintColor: COLORS.primary,
          tabBarInactiveTintColor: COLORS.muted,
          tabBarLabelStyle: { fontFamily: FONT.semibold, fontSize: 12 },
          tabBarItemStyle: { minHeight: 48 },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t(isPurchaser ? "tb.tab" : "mobile.requests"),
            tabBarIcon: ({ color }) => <IconSymbol name="list.clipboard.fill" size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="turn-in"
          options={{
            title: t("ti.tab"),
            href: isPurchaser ? undefined : null,
            tabBarBadge: turnInBadge > 0 ? turnInBadge : undefined,
            tabBarIcon: ({ color }) => <IconSymbol name="paperplane.fill" size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: t("hist.tab"),
            tabBarBadge: rejectedBadge > 0 ? rejectedBadge : undefined,
            tabBarIcon: ({ color }) => <IconSymbol name="receipt" size={24} color={color} />,
          }}
        />
        {/* Not a tab any more: Settings opens from the header. */}
        <Tabs.Screen name="account" options={{ href: null }} />
      </Tabs>
      {/* One bottom bar for both roles, the Site Manager's design. */}
      <SmBottomBar />
    </View>
  );
}
