import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { COLORS } from "@/constants/expense-flow-colors";

type Props = {
  title: string;
  // e.g. "Step 2 of 3" or "Split receipt · Step 1 of 3"
  caption?: string;
  // Hide the back chevron on a screen the user must not leave mid-action.
  hideBack?: boolean;
  onBack?: () => void;
};

// One header for every pushed screen: back chevron, title, step caption.
export function FlowHeader({ title, caption, hideBack, onBack }: Props) {
  function goBack() {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  return (
    <View style={styles.row}>
      {hideBack ? (
        <View style={styles.backSpacer} />
      ) : (
        <Pressable onPress={goBack} hitSlop={10} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back">
          <IconSymbol name="chevron.left" size={26} color={COLORS.heading} />
        </Pressable>
      )}
      <View style={styles.text}>
        {caption ? <Text style={styles.caption} numberOfLines={1}>{caption}</Text> : null}
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 10 },
  back: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18 },
  backSpacer: { width: 8 },
  text: { flex: 1 },
  caption: { fontSize: 12, color: COLORS.muted },
  title: { fontSize: 20, fontWeight: "800", color: COLORS.heading },
});
