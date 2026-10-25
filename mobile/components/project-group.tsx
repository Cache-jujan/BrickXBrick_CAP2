import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";

type Props = {
  title: string;
  /** One short line under the title, e.g. "3 items · PHP 4,200". */
  subtitle?: string;
  /** Tick state of everything inside. Leave out for a group that is only opened and closed. */
  state?: "all" | "some" | "none";
  open: boolean;
  onToggleOpen: () => void;
  /** Ticks or unticks everything inside in one tap. */
  onToggleTick?: () => void;
  children?: React.ReactNode;
};

// A project row that opens to show its items. Closed by default so a receipt that
// touches several projects reads in one glance; the box on the left ticks the whole
// project, the rest of the row opens it.
export function ProjectGroup({ title, subtitle, state, open, onToggleOpen, onToggleTick, children }: Props) {
  const ticked = state === "all" || state === "some";
  return (
    <View style={[styles.card, ticked && styles.cardOn]}>
      <View style={styles.header}>
        {state && onToggleTick ? (
          <Pressable
            onPress={onToggleTick}
            style={styles.boxHit}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: state === "all" ? true : state === "some" ? "mixed" : false }}
            accessibilityLabel={title}
            hitSlop={6}
          >
            <View style={[styles.box, ticked && styles.boxOn]}>
              {state === "all" ? <IconSymbol name="checkmark.circle.fill" size={20} color="#FFFFFF" /> : null}
              {state === "some" ? <View style={styles.dash} /> : null}
            </View>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onToggleOpen}
          style={({ pressed }) => [styles.titleHit, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
        >
          <View style={styles.flex}>
            <Text style={styles.title} numberOfLines={2}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
          <IconSymbol name={open ? "chevron.down" : "chevron.right"} size={18} color={COLORS.muted} />
        </Pressable>
      </View>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  cardOn: { borderColor: COLORS.primary },
  header: { flexDirection: "row", alignItems: "center", minHeight: MIN_TAP + 12 },
  boxHit: { minWidth: MIN_TAP, minHeight: MIN_TAP + 12, alignItems: "center", justifyContent: "center", paddingLeft: 8 },
  box: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: COLORS.inputBorder, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.card },
  boxOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primary },
  dash: { width: 12, height: 3, borderRadius: 2, backgroundColor: "#FFFFFF" },
  titleHit: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 12, minHeight: MIN_TAP + 12 },
  title: { fontSize: 16, fontFamily: FONT.bold, color: COLORS.heading },
  subtitle: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 1 },
  body: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingHorizontal: 12, paddingVertical: 4 },
});
