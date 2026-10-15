import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { fetchUnreadCount } from "@/lib/api";

const POLL_MS = 30_000;

// Shared bell+badge for the Purchaser header and the SM home header. Badge
// refreshes on focus and every 30s while the screen is focused, same cadence
// as the web Topbar's background poll.
export function NotificationBell({ color }: { color: string }) {
  const [count, setCount] = useState(0);

  const poll = useCallback(() => {
    fetchUnreadCount()
      .then(setCount)
      .catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const tick = () => { if (!cancelled) poll(); };
      tick();
      const interval = setInterval(tick, POLL_MS);
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }, [poll])
  );

  // Re-check the moment the user comes back from the notifications screen,
  // not just on the next 30s tick.
  useEffect(() => {
    poll();
  }, [poll]);

  return (
    <Pressable
      style={styles.bell}
      onPress={() => router.push("/notifications")}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
    >
      <IconSymbol name="bell.fill" size={22} color={color} />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 9 ? "9+" : count}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bell: { padding: 4, position: "relative" },
  badge: {
    position: "absolute",
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: "#B42318",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "800" },
});