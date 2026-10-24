import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { COLORS, FONT } from "@/constants/expense-flow-colors";
import type { MyExpense } from "@/lib/api";
import { formatPeso } from "@/lib/money";
import { useLocale } from "@/lib/i18n-context";

const RED = COLORS.errorText;
const RED_BG = COLORS.errorFill;

// Expenses the Project Manager rejected. Tapping one reopens it on the review
// screen with the receipt's values, ready to correct and resubmit. Renders
// nothing when there are none.
export function RejectedExpenses({ expenses, onFix }: { expenses: MyExpense[]; onFix: (expense: MyExpense) => void }) {
  const { t } = useLocale();
  if (expenses.length === 0) return null;

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t("re.title")}</Text>
      {expenses.map((expense) => (
        <Pressable
          key={expense.expenseID}
          onPress={() => onFix(expense)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t("re.aria", { vendor: expense.vendorName ?? t("mobile.receipt"), amount: formatPeso(expense.amount) })}
        >
          <View style={styles.flex}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {expense.vendorName ?? t("mobile.receipt")} · {formatPeso(expense.amount)}
            </Text>
            <Text style={styles.reason} numberOfLines={3}>
              {expense.rejectionReason ? `"${expense.rejectionReason}"` : t("rv.no_reason")}
            </Text>
          </View>
          <View style={styles.pill}>
            <IconSymbol name="exclamationmark.triangle.fill" size={14} color={RED} />
            <Text style={styles.pillText}>{t("re.fix")}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: RED, borderRadius: 14, padding: 12, marginBottom: 12, gap: 8 },
  title: { fontSize: 15, fontFamily: FONT.extrabold, color: RED },
  row: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: COLORS.border },
  pressed: { opacity: 0.7 },
  flex: { flex: 1 },
  rowTitle: { fontSize: 14, fontFamily: FONT.bold, color: COLORS.heading },
  reason: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 2, fontStyle: "italic" },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, backgroundColor: RED_BG },
  pillText: { fontSize: 12, fontFamily: FONT.bold, color: RED },
});
