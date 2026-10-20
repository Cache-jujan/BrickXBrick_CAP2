import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { fetchNotifications, markNotificationRead, type AppNotification } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { metaFor, routeForNotification } from "@/lib/notificationMeta";
import { emitNewNotifications } from "@/lib/notification-events";
import { kvGet, kvSet } from "@/lib/sync/db";
import { useNetwork } from "@/lib/sync/network-context";
import { pickNewNotifications } from "@/lib/sync/new-notifications";
import { COLORS, FONT } from "@/constants/expense-flow-colors";

const POLL_MS = 20_000;
const SHOW_MS = 6_000;

type Role = "Purchaser" | "Site Manager";

// In-app pop-up for a new notification, like a message banner on a phone:
// slides in at the top, tap to open it, × or wait 6 seconds to dismiss.
// It works while the app is open. Banners while the app is closed would need
// real push notifications (expo-notifications), which isn't in the stack.
export function NotificationToast() {
  const { isOnline } = useNetwork();
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState<{ n: AppNotification; more: number; role: Role } | null>(null);
  const slide = useRef(new Animated.Value(-160)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    Animated.timing(slide, { toValue: -160, duration: 200, useNativeDriver: true }).start(() => setShown(null));
  }, [slide]);

  const check = useCallback(async () => {
    const session = getSession();
    const role = session?.user.role;
    if (!session || (role !== "Purchaser" && role !== "Site Manager")) return;
    const key = `notif:lastSeen:${session.user.id}`;
    try {
      const rows = await fetchNotifications({ unreadOnly: true, limit: 10 });
      const { fresh, newestAt } = pickNewNotifications(rows, kvGet(key));
      if (newestAt) kvSet(key, newestAt);
      if (fresh.length === 0) return;
      emitNewNotifications(); // screens on show reload (task status, bell count)
      setShown({ n: fresh[0], more: fresh.length - 1, role });
      slide.setValue(-160);
      Animated.timing(slide, { toValue: 0, duration: 250, useNativeDriver: true }).start();
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(hide, SHOW_MS);
    } catch {
      // Offline or server busy: the next check tries again.
    }
  }, [hide, slide]);

  // Check now, every 20 seconds while online, and whenever the app comes back
  // to the front.
  useEffect(() => {
    if (!isOnline) return;
    check();
    const interval = setInterval(check, POLL_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [isOnline, check]);

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  if (!shown) return null;
  const { icon, bg, fg, fallback } = metaFor(shown.n.type);

  function open() {
    if (!shown) return;
    markNotificationRead(shown.n.notificationid).catch(() => {});
    const route = routeForNotification(shown.n, shown.role);
    hide();
    router.push(route ?? "/notifications");
  }

  return (
    <Animated.View
      style={[styles.wrap, { top: insets.top + 8, transform: [{ translateY: slide }] }]}
      accessibilityLiveRegion="polite"
    >
      <Pressable onPress={open} style={styles.card} accessibilityRole="button" accessibilityLabel={`New notification: ${shown.n.message || fallback}`}>
        <View style={[styles.icon, { backgroundColor: bg }]}>
          <IconSymbol name={icon} size={16} color={fg} />
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>BrickXBrick · now</Text>
          <Text style={styles.message} numberOfLines={2}>
            {shown.n.message || fallback}
          </Text>
          {shown.more > 0 && <Text style={styles.more}>+{shown.more} more in Notifications</Text>}
        </View>
        <Pressable onPress={hide} hitSlop={12} accessibilityRole="button" accessibilityLabel="Dismiss">
          <Text style={styles.close}>×</Text>
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12, zIndex: 1000, elevation: 12 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  body: { flex: 1 },
  title: { color: COLORS.muted, fontSize: 11, fontFamily: FONT.bold },
  message: { color: COLORS.heading, fontSize: 14, fontFamily: FONT.semibold, lineHeight: 19, marginTop: 2 },
  more: { color: COLORS.primary, fontSize: 11, fontFamily: FONT.bold, marginTop: 3 },
  close: { color: COLORS.muted, fontSize: 22, fontFamily: FONT.regular, paddingHorizontal: 4 },
});
