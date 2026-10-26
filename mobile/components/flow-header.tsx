import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { BackButton } from "@/components/back-button";
import { LanguageButton } from "@/components/language-button";
import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { useLocale } from "@/lib/i18n-context";

type Props = {
  title: string;
  // e.g. "Step 2 of 3" or "Split receipt · Step 1 of 3"
  caption?: string;
  // Hide the back chevron on a screen the user must not leave mid-action.
  hideBack?: boolean;
  onBack?: () => void;
  // Where Back goes when there is nothing to go back to (a deep link, a cold start).
  fallback?: string;
  // Filled bars under the header for a multi-step flow (e.g. step 2 of 3).
  step?: { current: number; total: number };
  // Something on the right of the bar, e.g. the notification bell or a text button.
  right?: ReactNode;
  // "bar": a compact one-line bar for screens that show their own large title
  // below it (the back button and a short name stay put while the page scrolls).
  variant?: "title" | "bar";
};

// One header for every pushed screen: back chevron, title, step caption.
export function FlowHeader({ title, caption, hideBack, onBack, fallback, step, right, variant = "title" }: Props) {
  const { t } = useLocale();
  const bar = variant === "bar";
  return (
    <View>
      <View style={[styles.row, bar && styles.rowBar]}>
        {hideBack ? <View style={styles.backSpacer} /> : <BackButton onPress={onBack} fallback={fallback} />}
        <View style={styles.text}>
          {caption ? <Text style={styles.caption} numberOfLines={1}>{caption}</Text> : null}
          <Text style={bar ? styles.barTitle : styles.title} numberOfLines={bar ? 1 : 2}>{title}</Text>
        </View>
        <View style={styles.right}>
          <LanguageButton />
          {right}
        </View>
      </View>
      {step ? (
        <View style={styles.progress} accessibilityLabel={t("mx.step_n", { current: step.current, total: step.total })}>
          {Array.from({ length: step.total }, (_, i) => (
            <View key={i} style={[styles.bar, i < step.current && styles.barFilled]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingTop: 4, paddingBottom: 8, minHeight: MIN_TAP + 12 },
  rowBar: { paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: COLORS.border, minHeight: MIN_TAP + 8 },
  backSpacer: { width: 8 },
  right: { paddingRight: 8, flexDirection: "row", alignItems: "center", minHeight: MIN_TAP },
  barTitle: { fontSize: 17, fontFamily: FONT.bold, color: COLORS.heading },
  text: { flex: 1 },
  caption: { fontSize: 12, fontFamily: FONT.medium, color: COLORS.muted },
  title: { fontSize: 22, fontFamily: FONT.extrabold, color: COLORS.heading },
  progress: { flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingBottom: 10 },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: COLORS.border },
  barFilled: { backgroundColor: COLORS.primary },
});
