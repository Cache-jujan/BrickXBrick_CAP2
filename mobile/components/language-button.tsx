import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { useLocale } from "@/lib/i18n-context";
import { useLanguageChoice } from "@/lib/use-language-choice";

// A globe button that opens a small language picker. The signed-in screens
// change language in Settings; this button is kept for the sign-in screen,
// where Settings cannot be reached yet. Choosing a language asks first
// (see useLanguageChoice, shared with the Settings screen).
export function LanguageButton({ color = COLORS.heading }: { color?: string }) {
  const { t } = useLocale();
  const { locale, options, choose } = useLanguageChoice();
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
            {options.map((option) => {
              const selected = locale === option.code;
              return (
                <Pressable
                  key={option.code}
                  onPress={() => {
                    // Close the picker first, then ask; a tap on the language already in use only closes it.
                    setOpen(false);
                    choose(option.code);
                  }}
                  style={({ pressed }) => [styles.option, selected && styles.optionOn, pressed && { opacity: 0.8 }]}
                  accessibilityRole="radio"
                  accessibilityLabel={t(option.nameKey)}
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
