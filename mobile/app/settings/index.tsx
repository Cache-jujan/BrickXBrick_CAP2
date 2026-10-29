import { useCallback, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Redirect, router, useFocusEffect } from "expo-router";
import Constants from "expo-constants";

import { FlowHeader } from "@/components/flow-header";
import { initialsOf, MainHeader } from "@/components/main-header";
import { Screen } from "@/components/screen";
import { SmBottomBar } from "@/components/sm-bottom-bar";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { removeAvatar, uploadAvatar } from "@/lib/api";
import { getSession, logout, setAvatarUrl } from "@/lib/auth";
import { compressAvatarImage } from "@/lib/compress-image";
import { useExpenseDraft } from "@/lib/expense-draft-context";
import { useLocale } from "@/lib/i18n-context";

const DANGER = COLORS.errorText;
const LANGUAGE_NAME_KEY = { en: "language.english", ceb: "language.bisaya", fil: "language.filipino" } as const;

// The home of Settings: a list of what can be changed, with the current value on
// the right. Nothing is editable here. Each row opens its own screen, and each
// change is confirmed there before it is saved. Shared by Purchasers and Site Managers.
export default function SettingsScreen() {
  const { locale, t } = useLocale();
  const { reset } = useExpenseDraft();
  // The sub-screens change the session; re-read it when we come back to this list.
  const [, refresh] = useState(0);
  useFocusEffect(useCallback(() => refresh((n) => n + 1), []));

  const session = getSession();
  if (!session) return <Redirect href="/login" />;

  const { name, username, email, role, avatarUrl } = session.user;
  const version = Constants.expoConfig?.version ?? "—";

  async function choosePhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert(t("mx.photo_needed_title"), t("mx.enable_settings"));
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1 });
    if (result.canceled) return;
    try {
      const picked = result.assets[0];
      const small = await compressAvatarImage(picked.uri, picked.width, picked.height);
      setAvatarUrl(await uploadAvatar(small.uri));
      refresh((n) => n + 1);
    } catch (err) {
      Alert.alert(t("settings.photo_failed"), err instanceof Error ? err.message : "");
    }
  }

  async function dropPhoto() {
    try {
      await removeAvatar();
      setAvatarUrl(null);
      refresh((n) => n + 1);
    } catch (err) {
      Alert.alert(t("settings.photo_failed"), err instanceof Error ? err.message : "");
    }
  }

  function openPhotoMenu() {
    Alert.alert(t("settings.photo_title"), undefined, [
      { text: t("settings.photo_choose"), onPress: choosePhoto },
      ...(avatarUrl ? [{ text: t("account.photo_remove"), style: "destructive" as const, onPress: dropPhoto }] : []),
      { text: t("common.cancel"), style: "cancel" as const },
    ]);
  }

  function confirmLogout() {
    Alert.alert(t("settings.logout_title"), t("settings.logout_message"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("account.logout"),
        style: "destructive",
        onPress: () => {
          // Clear any half-finished expense so it can't leak to the next user.
          reset();
          logout();
          // Drop every screen under us so Back can't return to a signed-in page.
          if (router.canDismiss()) router.dismissAll();
          router.replace("/login");
        },
      },
    ]);
  }

  return (
    <Screen
      header={role === "Site Manager" ? <MainHeader title={t("settings.title")} hideAvatar /> : <FlowHeader title={t("settings.title")} />}
      footer={<SmBottomBar />}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.profile}>
          <Pressable onPress={openPhotoMenu} style={styles.avatar} accessibilityRole="button" accessibilityLabel={t("settings.photo_title")}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImage} accessibilityIgnoresInvertColors />
            ) : (
              <Text style={styles.avatarText}>{initialsOf(name)}</Text>
            )}
          </Pressable>
          <Pressable onPress={openPhotoMenu} hitSlop={8} accessibilityRole="button">
            <Text style={styles.changePhoto}>{t(avatarUrl ? "account.photo_change" : "account.photo_add")}</Text>
          </Pressable>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.email} numberOfLines={1}>{email}</Text>
          <Text style={styles.meta}>{role} · v{version}</Text>
        </View>

        <View style={styles.group}>
          <NavRow label={t("settings.row_username")} value={username || t("settings.not_set")} onPress={() => router.push("/settings/username")} />
          <View style={styles.separator} />
          <NavRow label={t("settings.row_password")} value="••••••••" onPress={() => router.push("/settings/password")} />
          <View style={styles.separator} />
          <NavRow label={t("language.name")} value={t(LANGUAGE_NAME_KEY[locale])} onPress={() => router.push("/settings/language")} />
        </View>

        <View style={styles.group}>
          <NavRow label={t("settings.terms")} onPress={() => router.push("/terms")} />
        </View>

        <Pressable
          onPress={confirmLogout}
          style={({ pressed }) => [styles.logout, pressed && { opacity: 0.8 }]}
          accessibilityRole="button"
        >
          <Text style={styles.logoutText}>{t("account.logout")}</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function NavRow({ label, value, onPress }: { label: string; value?: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        {value ? <Text style={styles.rowValue} numberOfLines={1}>{value}</Text> : null}
        <IconSymbol name="chevron.right" size={18} color={COLORS.muted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16 },
  profile: { alignItems: "center", paddingVertical: 12 },
  avatar: { alignItems: "center", backgroundColor: COLORS.primary, borderRadius: 40, height: 80, justifyContent: "center", overflow: "hidden", width: 80 },
  avatarImage: { height: 80, width: 80 },
  changePhoto: { color: COLORS.primary, fontFamily: FONT.bold, fontSize: 13, marginTop: 8 },
  avatarText: { color: "#FFFFFF", fontFamily: FONT.extrabold, fontSize: 28 },
  name: { color: COLORS.heading, fontFamily: FONT.extrabold, fontSize: 20, marginTop: 12, maxWidth: "90%" },
  email: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 13, marginTop: 2 },
  meta: { color: COLORS.muted, fontFamily: FONT.medium, fontSize: 12, marginTop: 6 },
  group: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  separator: { backgroundColor: COLORS.border, height: 1, marginLeft: 16 },
  row: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between", minHeight: MIN_TAP + 8, paddingHorizontal: 16 },
  rowPressed: { backgroundColor: COLORS.bg },
  rowLabel: { color: COLORS.heading, fontFamily: FONT.semibold, fontSize: 15 },
  rowRight: { alignItems: "center", flexDirection: "row", flexShrink: 1, gap: 6 },
  rowValue: { color: COLORS.muted, flexShrink: 1, fontFamily: FONT.regular, fontSize: 14 },
  logout: { alignItems: "center", backgroundColor: COLORS.card, borderColor: DANGER, borderRadius: 14, borderWidth: 1, paddingVertical: 14 },
  logoutText: { color: DANGER, fontFamily: FONT.bold, fontSize: 15 },
});
