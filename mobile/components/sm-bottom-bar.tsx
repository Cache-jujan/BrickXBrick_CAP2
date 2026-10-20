import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, usePathname, type Href } from "expo-router";

import { COLORS } from "@/constants/expense-flow-colors";
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
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {TABS.map((tab) => {
        const active = tab.match.includes(pathname);
        return (
          <Pressable
            key={tab.label}
            onPress={() => {
              if (!active) router.replace(tab.href);
            }}
            style={styles.item}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
          >
            <IconSymbol name={tab.icon} size={22} color={active ? COLORS.primary : COLORS.muted} />
            <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: "#FFFCF8",
    borderTopColor: "#E7DDCF",
    borderTopWidth: 1,
    flexDirection: "row",
    paddingTop: 8,
  },
  item: { alignItems: "center", flex: 1, gap: 3, paddingVertical: 4 },
  label: { color: COLORS.muted, fontSize: 11, fontWeight: "700" },
  labelActive: { color: COLORS.primary },
});