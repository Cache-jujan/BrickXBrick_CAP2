import { useSyncExternalStore } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { BrandMark } from "@/components/brand-mark";
import { LanguageButton } from "@/components/language-button";
import { NotificationBell } from "@/components/notification-bell";
import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { getSession, subscribeSession } from "@/lib/auth";
import { useLocale } from "@/lib/i18n-context";

type Props = {
  // A large page title under the brand row ("My requests").
  title?: string;
  // The small line under the brand name (Tasks home only).
  tagline?: string;
  // Hide the profile button, e.g. on Settings itself.
  hideAvatar?: boolean;
};

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "U";
}

// The one top bar of every main screen (Tasks, Receipt, Requests, Settings for
// Site Managers; Requests and Expenses for Purchasers): logo and name on the
// left, notifications and the profile button on the right. The page title, if
// any, goes under it. It sits on the page background, so there is no box.
export function MainHeader({ title, tagline, hideAvatar }: Props) {
  const { t } = useLocale();
  // Listens for changes, so a new photo or name shows here without signing in again.
  const name = useSyncExternalStore(subscribeSession, () => getSession()?.user.name ?? "");
  const avatarUrl = useSyncExternalStore(subscribeSession, () => getSession()?.user.avatarUrl ?? null);
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.brand}>
          <BrandMark size={34} />
          <View>
            <Text style={styles.brandName}>Brick x Brick</Text>
            {tagline ? <Text style={styles.tagline}>{tagline}</Text> : null}
          </View>
        </View>
        <View style={styles.actions}>
          <LanguageButton />
          <NotificationBell color={COLORS.heading} />
          {hideAvatar ? null : (
            <Pressable
              onPress={() => router.push("/settings")}
              style={styles.avatar}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t("mh.open_settings")}
            >
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImage} accessibilityIgnoresInvertColors />
              ) : (
                <Text style={styles.avatarText}>{initialsOf(name)}</Text>
              )}
            </Pressable>
          )}
        </View>
      </View>
      {title ? <Text style={styles.title}>{title}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
  row: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: MIN_TAP + 4 },
  brand: { alignItems: "center", flex: 1, flexDirection: "row", gap: 10 },
  brandName: { color: COLORS.heading, fontFamily: FONT.extrabold, fontSize: 18 },
  tagline: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 11, marginTop: 1 },
  actions: { alignItems: "center", flexDirection: "row", gap: 4 },
  avatar: { alignItems: "center", backgroundColor: COLORS.primary, borderRadius: 22, height: MIN_TAP, justifyContent: "center", overflow: "hidden", width: MIN_TAP },
  avatarImage: { height: MIN_TAP, width: MIN_TAP },
  avatarText: { color: "#FFFFFF", fontFamily: FONT.extrabold, fontSize: 15 },
  title: { color: COLORS.heading, fontFamily: FONT.extrabold, fontSize: 28, letterSpacing: -0.5, marginTop: 14 },
});
