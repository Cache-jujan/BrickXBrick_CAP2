import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { confirmAction } from "@/lib/confirm";
import { useLocale, type AppLocale } from "@/lib/i18n-context";

const OPTIONS: { code: AppLocale; short: string; nameKey: string }[] = [
  { code: "en", short: "EN", nameKey: "language.english" },
  { code: "ceb", short: "CEB", nameKey: "language.bisaya" },
  { code: "fil", short: "FIL", nameKey: "language.filipino" },
];

// A globe button for any screen's top bar. Tapping it opens a small picker, so
// the language can be changed without going to Settings.
export function LanguageButton({ color = COLORS.heading }: { color?: string }) {
  const { locale, setLanguage, t } = useLocale();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={6}
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel={t("language.name")}
      >
        <MaterialIcons name="language" size={24} color={color} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* Inner Pressable swallows taps so only the backdrop closes the picker. */}
          <Pressable style={styles.sheet} onPress={() => {}} accessibilityRole="radiogroup">
            <Text style={styles.title}>{t("language.name")}</Text>
            {OPTIONS.map((option) => {
              const selected = locale === option.code;
              return (
                <Pressable
                  key={option.code}
                  onPress={async () => {
                    setOpen(false);
                    if (selected) return;
                    const ok = await confirmAction({
                      title: t("settings.confirm_language_title"),
                      message: t("settings.confirm_language_body", { language: t(option.nameKey) }),
                      confirmLabel: t("settings.confirm_yes"),
                      cancelLabel: t("common.cancel"),
                    });
                    if (ok) setLanguage(option.code);
                  }}
                  style={({ pressed }) => [styles.option, selected && styles.optionOn, pressed && { opacity: 0.8 }]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                >
                  <Text style={styles.optionText}>{t(option.nameKey)}</Text>
                  <Text style={[styles.badge, selected && styles.badgeOn]}>{selected ? "✓" : option.short}</Text>
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: "center", height: MIN_TAP, justifyContent: "center", width: MIN_TAP },
  backdrop: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.35)", flex: 1, justifyContent: "center", padding: 24 },
  sheet: { backgroundColor: COLORS.card, borderRadius: 16, gap: 10, maxWidth: 360, padding: 16, width: "100%" },
  title: { color: COLORS.heading, fontFamily: FONT.bold, fontSize: 16, marginBottom: 2 },
  option: { alignItems: "center", backgroundColor: COLORS.bg, borderColor: COLORS.border, borderRadius: 12, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 48, paddingHorizontal: 14 },
  optionOn: { borderColor: COLORS.primary },
  optionText: { color: COLORS.primary, fontFamily: FONT.bold, fontSize: 14 },
  badge: { backgroundColor: COLORS.border, borderRadius: 12, color: COLORS.heading, fontFamily: FONT.bold, fontSize: 11, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4 },
  badgeOn: { backgroundColor: COLORS.primary, color: "#FFFFFF" },
});
