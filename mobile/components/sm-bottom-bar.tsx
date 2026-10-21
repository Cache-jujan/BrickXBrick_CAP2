import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, usePathname, type Href } from "expo-router";

import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { getSession } from "@/lib/auth";
import { IconSymbol } from "@/components/ui/icon-symbol";

type Tab = {
  label: string;
  href: Href;
  icon: "list.clipboard.fill" | "camera.fill" | "ticket.fill" | "gearshape.fill";
  // Pathnames that should light this tab up.
  match: string[];
};

const TABS: Tab[] = [
  { label: "Tasks", href: "/site-manager" as Href, icon: "list.clipboard.fill", match: ["/site-manager"] },
  { label: "Receipt", href: "/(tabs)" as Href, icon: "camera.fill", match: ["/", "/index"] },
  { label: "Requests", href: "/site-manager/my-requests" as Href, icon: "ticket.fill", match: ["/site-manager/my-requests"] },
  { label: "Settings", href: "/settings" as Href, icon: "gearshape.fill", match: ["/settings"] },
];

// Bottom navigation for Site Manager screens. It renders nothing for any other
// role, so it is safe to drop into a screen Purchasers also use.
export function SmBottomBar() {
  const session = getSession();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  if (session?.user.role !== "Site Manager") return null;

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.pill}>
        {TABS.map((tab) => {
          const active = tab.match.includes(pathname);
          return (
            <Pressable
              key={tab.label}
              onPress={() => {
                if (!active) router.replace(tab.href);
              }}
              style={[styles.item, active && styles.itemActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tab.label}
            >
              <IconSymbol name={tab.icon} size={22} color={active ? "#FFFFFF" : "#CFC6BA"} />
              {active ? <Text style={styles.label} numberOfLines={1}>{tab.label}</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// A floating dark pill: the open tab is an orange capsule with its name, the
// others are icons only (each still has an accessibility label).
const styles = StyleSheet.create({
  wrap: { backgroundColor: COLORS.bgWarm, paddingHorizontal: 16, paddingTop: 8 },
  pill: { alignItems: "center", backgroundColor: COLORS.heading, borderRadius: 32, flexDirection: "row", justifyContent: "space-between", padding: 6 },
  item: { alignItems: "center", borderRadius: 26, flexDirection: "row", gap: 6, height: MIN_TAP + 4, justifyContent: "center", minWidth: MIN_TAP + 4, paddingHorizontal: 12 },
  itemActive: { backgroundColor: COLORS.primary, paddingHorizontal: 16 },
  label: { color: "#FFFFFF", fontFamily: FONT.bold, fontSize: 13 },
});
