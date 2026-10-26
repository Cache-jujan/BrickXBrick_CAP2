import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { NotificationBell } from "@/components/notification-bell";
import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { useLocale } from "@/lib/i18n-context";

const HEADER = {
  bg: COLORS.card,
  ink: COLORS.heading,
  border: COLORS.border,
};

// Brand on the left, gear on the right. Logout lives only in Settings so it
// can't be tapped by accident from the home screen.
export function AppHeader() {
  const { t } = useLocale();
  return (
    <View style={styles.bar}>
      <Text style={styles.brand} numberOfLines={1}>
        BxB
      </Text>

      <View style={styles.actions}>
        <NotificationBell color={HEADER.ink} />
        <Pressable
          style={styles.gear}
          onPress={() => router.push("/settings")}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t("mh.open_settings")}
        >
          <IconSymbol name="gearshape.fill" size={22} color={HEADER.ink} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: HEADER.bg,
    borderBottomWidth: 1,
    borderBottomColor: HEADER.border,
  },
  brand: {
    fontSize: 16,
    fontFamily: FONT.extrabold,
    color: HEADER.ink,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  gear: {
    width: MIN_TAP,
    height: MIN_TAP,
    alignItems: "center",
    justifyContent: "center",
  },
});