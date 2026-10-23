import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import Constants from "expo-constants";

import { FlowHeader } from "@/components/flow-header";
import { MainHeader } from "@/components/main-header";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { getSession, logout } from "@/lib/auth";
import { useExpenseDraft } from "@/lib/expense-draft-context";
import { COLORS, FONT } from "@/constants/expense-flow-colors";
import { Screen } from "@/components/screen";
import { SmBottomBar } from "@/components/sm-bottom-bar";
import { useLocale } from "@/lib/i18n-context";

const DANGER = COLORS.errorText;

// Shared by Purchasers and Site Managers. This is the only place to log out.
export default function SettingsScreen() {
  const { locale, toggleLanguage, t } = useLocale();
  const { reset } = useExpenseDraft();
  const session = getSession();
  if (!session) return <Redirect href="/login" />;

  const { name, email, role } = session.user;
  const version = Constants.expoConfig?.version ?? "—";

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
        <View style={styles.card}>
          <View style={styles.profileRow}>
            <IconSymbol name="person.crop.circle" size={44} color={COLORS.muted} />
            <View style={styles.profileText}>
              <Text style={styles.name} numberOfLines={1}>{name}</Text>
              <Text style={styles.email} numberOfLines={1}>{email}</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <Row label={t("settings.role")} value={role} />
          <Row label={t("settings.app_version")} value={version} />
        </View>

        <View style={styles.card}>
          <View style={styles.languageHeading}>
            <Text style={styles.languageTitle}>{t("language.name")}</Text>
            <Text style={styles.languageValue}>{t(locale === "ceb" ? "language.bisaya" : "language.english")}</Text>
          </View>
          <Pressable
            onPress={toggleLanguage}
            style={({ pressed }) => [styles.languageButton, pressed && { opacity: 0.8 }]}
            accessibilityRole="switch"
            accessibilityState={{ checked: locale === "ceb" }}
            accessibilityLabel={t(locale === "ceb" ? "language.english_action" : "language.translate")}
          >
            <Text style={styles.languageButtonText}>{t(locale === "ceb" ? "language.english_action" : "language.translate")}</Text>
            <Text style={[styles.switchTrack, locale === "ceb" && styles.switchTrackOn]}>
              {locale === "ceb" ? "✓" : "EN"}
            </Text>
          </Pressable>
          <Text style={styles.languageHelp}>{t("mobile.settings_language_help")}</Text>
        </View>

        <Pressable
          onPress={() => router.push("/terms")}
          style={({ pressed }) => [styles.card, styles.linkRow, pressed && { opacity: 0.8 }]}
          accessibilityRole="link"
        >
          <Text style={styles.linkText}>{t("settings.terms")}</Text>
          <IconSymbol name="chevron.right" size={18} color={COLORS.muted} />
        </Pressable>

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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, gap: 16 },
  card: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 16 },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  profileText: { flex: 1 },
  name: { fontSize: 17, fontFamily: FONT.extrabold, color: COLORS.heading },
  email: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 2 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 14 },
  languageHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  languageTitle: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.heading },
  languageValue: { fontSize: 13, fontFamily: FONT.medium, color: COLORS.muted },
  languageButton: { alignItems: "center", backgroundColor: COLORS.bg, borderColor: COLORS.border, borderRadius: 12, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 12, minHeight: 48, paddingHorizontal: 14 },
  languageButtonText: { color: COLORS.primary, fontFamily: FONT.bold, fontSize: 14 },
  switchTrack: { alignItems: "center", backgroundColor: COLORS.border, borderRadius: 12, color: COLORS.heading, fontFamily: FONT.bold, fontSize: 11, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4 },
  switchTrackOn: { backgroundColor: COLORS.primary, color: "#FFFFFF" },
  languageHelp: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 12, marginTop: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  rowLabel: { fontSize: 14, fontFamily: FONT.regular, color: COLORS.muted },
  rowValue: { fontSize: 14, fontFamily: FONT.semibold, color: COLORS.heading },
  linkRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  linkText: { fontSize: 15, fontFamily: FONT.semibold, color: COLORS.heading },
  logout: { borderWidth: 1, borderColor: DANGER, borderRadius: 14, paddingVertical: 14, alignItems: "center", backgroundColor: COLORS.card },
  logoutText: { color: DANGER, fontSize: 15, fontFamily: FONT.bold },
});
