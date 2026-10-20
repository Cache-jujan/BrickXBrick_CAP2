import { StyleSheet, Text, View } from "react-native";

// Shown right above an action button that can't run yet, so the user sees
// exactly why instead of a greyed-out button with no explanation.
export function BlockedReasons({
  reasons,
  title = "Before you can continue:",
}: {
  reasons: (string | false | null | undefined)[];
  title?: string;
}) {
  const list = reasons.filter((r): r is string => !!r);
  if (list.length === 0) return null;
  return (
    <View style={styles.box} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.title}>{title}</Text>
      {list.map((reason) => (
        <Text key={reason} style={styles.item}>
          • {reason}
        </Text>
      ))}
    </View>
  );
}

// Red outline for a field the user still needs to fix.
export const fieldErrorStyle = { borderColor: "#D92D20", borderWidth: 1.5 } as const;

const styles = StyleSheet.create({
  box: {
    backgroundColor: "#FFF5F3",
    borderColor: "#F4C7C3",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    gap: 3,
  },
  title: { color: "#B42318", fontSize: 13, fontWeight: "800" },
  item: { color: "#8C2D24", fontSize: 13, lineHeight: 19 },
});
