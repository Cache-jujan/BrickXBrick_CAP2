import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";

import { COLORS } from "@/constants/expense-flow-colors";
import { parseNeededBy, shortDate, toDateText } from "@/lib/needed-by";
import { useLocale } from "@/lib/i18n-context";

type Props = {
  label: string;
  // "YYYY-MM-DD", or "" when no date is chosen.
  value: string;
  onChange: (value: string) => void;
  hint?: string;
};

// Optional date picker: tap to choose a day (today or later), tap Clear to remove it.
export function DateField({ label, value, onChange, hint }: Props) {
  const { t, intlLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const selected = parseNeededBy(value);
  const today = new Date();

  function handleChange(event: DateTimePickerEvent, date?: Date) {
    // Android shows a dialog: close it on either choice. iOS stays inline.
    if (Platform.OS === "android") setOpen(false);
    if (event.type === "set" && date) onChange(toDateText(date));
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Pressable
          onPress={() => setOpen((v) => !v)}
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel={selected ? t("df.aria_set", { label, date: shortDate(selected, intlLocale) }) : t("df.aria_unset", { label })}
        >
          <Text style={[styles.value, !selected && styles.placeholder]}>
            {selected ? selected.toLocaleDateString(intlLocale, { day: "numeric", month: "long", year: "numeric" }) : t("df.no_date")}
          </Text>
        </Pressable>
        {selected && (
          <Pressable onPress={() => { onChange(""); setOpen(false); }} style={styles.clear} accessibilityRole="button" accessibilityLabel={t("df.clear_date")}>
            <Text style={styles.clearText}>{t("rep.clear")}</Text>
          </Pressable>
        )}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {open && (
        <DateTimePicker
          value={selected ?? today}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          minimumDate={today}
          onChange={handleChange}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  label: { fontSize: 13, fontWeight: "700", color: COLORS.heading, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  button: { flex: 1, minHeight: 48, justifyContent: "center", paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: "#C9CDD5", backgroundColor: COLORS.card },
  value: { fontSize: 15, color: COLORS.heading },
  placeholder: { color: COLORS.muted },
  clear: { minHeight: 48, minWidth: 56, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  clearText: { fontSize: 14, fontWeight: "700", color: COLORS.primary },
  hint: { fontSize: 12, color: COLORS.muted, marginTop: 4 },
});
