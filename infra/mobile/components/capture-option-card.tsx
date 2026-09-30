import { Pressable, StyleSheet, Text, View } from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";

type CaptureOptionCardProps = {
  title: string;
  description?: string;
  icon: "camera.fill" | "photo.on.rectangle" | "doc.fill";
  tint: string;
  iconBackground: string;
  onPress: () => void;
  /**
   * Renders a smaller, icon+label-only tile instead of the full
   * icon+title+description row. Use this on short screens so the three
   * capture options can sit side-by-side and leave room for the preview.
   */
  compact?: boolean;
};

export function CaptureOptionCard({
  title,
  description,
  icon,
  tint,
  iconBackground,
  onPress,
  compact = false,
}: CaptureOptionCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        compact ? styles.cardCompact : styles.card,
        pressed && { opacity: 0.78, transform: [{ scale: 0.98 }] },
      ]}
    >
      <View
        style={[
          compact ? styles.iconWrapCompact : styles.iconWrap,
          { backgroundColor: iconBackground },
        ]}
      >
        <IconSymbol name={icon} size={compact ? 18 : 26} color={tint} />
      </View>

      <View style={compact ? styles.bodyCompact : styles.body}>
        <Text
          style={compact ? styles.titleCompact : styles.title}
          numberOfLines={compact ? 2 : 1}
        >
          {title}
        </Text>
        {!compact && description ? (
          <Text style={styles.description} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>

      {!compact && (
        <Text aria-hidden style={styles.chevron}>
          ›
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Full-size, stacked row layout (roomy screens)
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#EDE6D9",
    padding: 14,
    gap: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1A1A1A",
  },
  description: {
    fontSize: 11,
    color: "#8A8272",
    marginTop: 2,
  },
  chevron: {
    fontSize: 20,
    color: "#C9BFA8",
  },

  // Compact, icon-on-top tile (small screens — sits in a horizontal row)
  cardCompact: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#EDE6D9",
    paddingVertical: 10,
    paddingHorizontal: 4,
    gap: 6,
    minHeight: 64,
  },
  iconWrapCompact: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  bodyCompact: {
    alignItems: "center",
  },
  titleCompact: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#1A1A1A",
    textAlign: "center",
  },
});