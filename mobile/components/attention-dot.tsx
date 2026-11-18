import { StyleSheet, View } from "react-native";

import { COLORS } from "@/constants/expense-flow-colors";

// A small red dot: this row needs a tap. Sits before the title.
export function AttentionDot() {
  return <View style={styles.dot} accessibilityElementsHidden importantForAccessibility="no" />;
}

const styles = StyleSheet.create({
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: COLORS.errorText },
});
