import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { FlowHeader } from "@/components/flow-header";
import { Screen } from "@/components/screen";
import { COLORS, FONT } from "@/constants/expense-flow-colors";
import { confirmAction } from "@/lib/confirm";
import { useLocale, type AppLocale } from "@/lib/i18n-context";

const OPTIONS: { code: AppLocale; short: string; nameKey: string }[] = [
  { code: "en", short: "EN", nameKey: "language.english" },
  { code: "ceb", short: "CEB", nameKey: "language.bisaya" },
  { code: "fil", short: "FIL", nameKey: "language.filipino" },
];

// Picking a language asks first; nothing changes until it is confirmed.
export default function LanguageScreen() {
  const { locale, setLanguage, t } = useLocale();

  async function choose(code: AppLocale, nameKey: string) {
    if (code === locale) return;
    const ok = await confirmAction({
      title: t("settings.confirm_language_title"),
      message: t("settings.confirm_language_body", { language: t(nameKey) }),
      confirmLabel: t("settings.confirm_yes"),
      cancelLabel: t("common.cancel"),
    });
    if (ok) setLanguage(code);
  }

  return (
    <Screen header={<FlowHeader title={t("language.name")} fallback="/settings" />}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.group} accessibilityRole="radiogroup">
          {OPTIONS.map((option, i) => {
            const selected = locale === option.code;
            return (
              <View key={option.code}>
                {i > 0 ? <View style={styles.separator} /> : null}
                <Pressable
                  onPress={() => choose(option.code, option.nameKey)}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: COLORS.bg }]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                >
                  <Text style={styles.rowLabel}>{t(option.nameKey)}</Text>
                  <Text style={[styles.badge, selected && styles.badgeOn]}>{selected ? "✓" : option.short}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
        <Text style={styles.help}>{t("mobile.settings_language_help")}</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  group: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  separator: { backgroundColor: COLORS.border, height: 1, marginLeft: 16 },
  row: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 56, paddingHorizontal: 16 },
  rowLabel: { color: COLORS.heading, fontFamily: FONT.semibold, fontSize: 15 },
  badge: { backgroundColor: COLORS.border, borderRadius: 12, color: COLORS.heading, fontFamily: FONT.bold, fontSize: 11, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4 },
  badgeOn: { backgroundColor: COLORS.primary, color: "#FFFFFF" },
  help: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 12 },
});
