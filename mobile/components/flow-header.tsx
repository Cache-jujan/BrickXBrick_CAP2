import { StyleSheet, Text, View } from "react-native";

import { BackButton } from "@/components/back-button";
import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";

type Props = {
  title: string;
  // e.g. "Step 2 of 3" or "Split receipt · Step 1 of 3"
  caption?: string;
  // Hide the back chevron on a screen the user must not leave mid-action.
  hideBack?: boolean;
  onBack?: () => void;
  // Filled bars under the header for a multi-step flow (e.g. step 2 of 3).
  step?: { current: number; total: number };
};

// One header for every pushed screen: back chevron, title, step caption.
export function FlowHeader({ title, caption, hideBack, onBack, step }: Props) {
  return (
    <View>
      <View style={styles.row}>
        {hideBack ? <View style={styles.backSpacer} /> : <BackButton onPress={onBack} />}
        <View style={styles.text}>
          {caption ? <Text style={styles.caption} numberOfLines={1}>{caption}</Text> : null}
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
        </View>
      </View>
      {step ? (
        <View style={styles.progress} accessibilityLabel={`Step ${step.current} of ${step.total}`}>
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
  backSpacer: { width: 8 },
  text: { flex: 1 },
  caption: { fontSize: 12, fontFamily: FONT.medium, color: COLORS.muted },
  title: { fontSize: 22, fontFamily: FONT.extrabold, color: COLORS.heading },
  progress: { flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingBottom: 10 },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: COLORS.border },
  barFilled: { backgroundColor: COLORS.primary },
});
