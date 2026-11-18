import { useEffect, useState } from "react";
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, usePathname, type Href } from "expo-router";

import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { getSession } from "@/lib/auth";
import { useRejectedBadge } from "@/lib/history-badge";
import { useTurnInBadge } from "@/lib/turnin-badge";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useLocale } from "@/lib/i18n-context";

type Tab = {
  label: string;
  href: Href;
  icon: "list.clipboard.fill" | "camera.fill" | "receipt" | "ticket.fill" | "paperplane.fill";
  // Pathnames that should light this tab up.
  match: string[];
};

const SITE_MANAGER_TABS: Tab[] = [
  { label: "mobile.tasks_nav", href: "/site-manager" as Href, icon: "list.clipboard.fill", match: ["/site-manager"] },
  { label: "mobile.requests", href: "/site-manager/my-requests" as Href, icon: "ticket.fill", match: ["/site-manager/my-requests"] },
  { label: "mobile.receipt_nav", href: "/(tabs)" as Href, icon: "camera.fill", match: ["/", "/index"] },
  { label: "hist.tab", href: "/history" as Href, icon: "receipt", match: ["/history"] },
];

// The Purchaser uses the same bar: To Buy / Turn In / History.
const PURCHASER_TABS: Tab[] = [
  { label: "tb.tab", href: "/(tabs)" as Href, icon: "list.clipboard.fill", match: ["/", "/index"] },
  { label: "ti.tab", href: "/turn-in" as Href, icon: "paperplane.fill", match: ["/turn-in"] },
  { label: "hist.tab", href: "/history" as Href, icon: "receipt", match: ["/history"] },
];

// The floating bottom navigation for the Site Manager and the Purchaser (the file keeps its old name).
// It renders nothing for any other role, so it is safe to drop into a screen several roles use.
export function SmBottomBar() {
  const { t } = useLocale();
  const session = getSession();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const rejectedBadge = useRejectedBadge();
  const turnInBadge = useTurnInBadge();

  // The tab just tapped is shown as open at once; waiting for the route to change made the pill feel slow.
  const [tapped, setTapped] = useState<string | null>(null);
  useEffect(() => { setTapped(null); }, [pathname]);
  useEffect(() => {
    if (!tapped) return;
    const id = setTimeout(() => setTapped(null), 800); // if the screen never changed, fall back to the real one
    return () => clearTimeout(id);
  }, [tapped]);

  const role = session?.user.role;
  if (role !== "Site Manager" && role !== "Purchaser") return null;
  const TABS = role === "Purchaser" ? PURCHASER_TABS : SITE_MANAGER_TABS;
  const activeTab = (tapped ? TABS.find((tab) => tab.href.toString() === tapped) : null) ?? TABS.find((tab) => tab.match.includes(pathname));
  // Number on a tab: scans waiting to be turned in, or rejected expenses in History.
  const badgeFor = (icon: Tab["icon"]) => (icon === "receipt" ? rejectedBadge : icon === "paperplane.fill" ? turnInBadge : 0);

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.pill}>
        {TABS.map((tab) => {
          const active = tab === activeTab;
          return (
            <Pressable
              key={tab.href.toString()}
              onPress={() => {
                if (active) return;
                // A short slide as the orange capsule moves; the Purchaser's tabs stay mounted, so "navigate"
                // just switches to the one already there. The Site Manager's screens are separate routes, so those are replaced.
                LayoutAnimation.configureNext(LayoutAnimation.create(160, "easeInEaseOut", "opacity"));
                setTapped(tab.href.toString());
                if (role === "Purchaser") router.navigate(tab.href);
                else router.replace(tab.href);
              }}
              style={[styles.item, active && styles.itemActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t(tab.label)}
            >
              <IconSymbol name={tab.icon} size={22} color={active ? "#FFFFFF" : "#CFC6BA"} />
              {active ? <Text style={styles.label} numberOfLines={1}>{t(tab.label)}</Text> : null}
              {badgeFor(tab.icon) > 0 ? (
                <View style={styles.badge}><Text style={styles.badgeText}>{badgeFor(tab.icon)}</Text></View>
              ) : null}
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
  badge: { position: "absolute", top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.errorText },
  badgeText: { color: "#FFFFFF", fontFamily: FONT.bold, fontSize: 11 },
});
