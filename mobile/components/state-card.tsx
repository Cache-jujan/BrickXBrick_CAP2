import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { AppButton } from "@/components/app-button";
import { COLORS, FONT } from "@/constants/expense-flow-colors";

type Kind = "empty" | "error" | "loading" | "offline";

type Props = {
  kind: Kind;
  title?: string;
  body?: string;
  // Shows a "Try again" style button when given.
  onRetry?: () => void;
  retryLabel?: string;
};

const GLYPH: Record<Exclude<Kind, "loading">, { glyph: string; bg: string; fg: string }> = {
  empty: { glyph: "✓", bg: COLORS.successBg, fg: COLORS.success },
  error: { glyph: "!", bg: COLORS.errorFill, fg: COLORS.errorText },
  offline: { glyph: "↯", bg: COLORS.amberBannerFill, fg: COLORS.amberText },
};

// The one empty / error / loading / offline panel. Plain words, one action.
export function StateCard({ kind, title, body, onRetry, retryLabel = "Try again" }: Props) {
  return (
    <View style={styles.card} accessibilityRole={kind === "error" ? "alert" : undefined}>
      {kind === "loading" ? (
        <ActivityIndicator color={COLORS.primary} />
      ) : (
        <View style={[styles.icon, { backgroundColor: GLYPH[kind].bg }]}>
          <Text style={[styles.iconText, { color: GLYPH[kind].fg }]}>{GLYPH[kind].glyph}</Text>
        </View>
      )}
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {onRetry ? <AppButton label={retryLabel} onPress={onRetry} variant="secondary" fit style={styles.action} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: "center", backgroundColor: COLORS.card, borderColor: COLORS.border, borderRadius: 16, borderWidth: 1, gap: 6, paddingHorizontal: 24, paddingVertical: 28 },
  icon: { alignItems: "center", borderRadius: 24, height: 48, justifyContent: "center", width: 48 },
  iconText: { fontFamily: FONT.extrabold, fontSize: 22 },
  title: { color: COLORS.heading, fontFamily: FONT.extrabold, fontSize: 16, marginTop: 4, textAlign: "center" },
  body: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 13, lineHeight: 19, textAlign: "center" },
  action: { alignSelf: "center", marginTop: 10 },
});
