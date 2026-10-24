import { StyleSheet, Text, View } from "react-native";
import { COLORS, FONT } from "@/constants/expense-flow-colors";
import { useLocale } from "@/lib/i18n-context";

// Shown right above an action button that can't run yet, so the user sees
// exactly why instead of a greyed-out button with no explanation.
export function BlockedReasons({
  reasons,
  title,
}: {
  reasons: (string | false | null | undefined)[];
  title?: string;
}) {
  const { t } = useLocale();
  const list = reasons.filter((r): r is string => !!r);
  if (list.length === 0) return null;
  return (
    <View style={styles.box} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.title}>{title ?? t("mx.before_continue")}</Text>
      {list.map((reason) => (
        <Text key={reason} style={styles.item}>
          • {reason}
        </Text>
      ))}
    </View>
  );
}

// Red outline for a field the user still needs to fix.
export const fieldErrorStyle = { borderColor: COLORS.errorText, borderWidth: 1.5 } as const;

const styles = StyleSheet.create({
  box: {
    backgroundColor: COLORS.errorFill,
    borderColor: COLORS.errorBorder,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    gap: 3,
  },
  title: { color: COLORS.errorText, fontSize: 13, fontFamily: FONT.extrabold },
  item: { color: COLORS.errorText, fontSize: 13, fontFamily: FONT.regular, lineHeight: 19 },
});
