// line-status.tsx: the small status icon beside a receipt line's name on Review, and the popup it opens.
//
// One icon says what the Purchaser should do about the line, and its shape (not only its colour) tells the
// states apart:
//   unmatched  warning triangle, yellow   no open request fits the name, so the line will not be allocated
//   check      info circle, yellow        the scan was unsure of this line: compare it with the receipt
//   matched    check circle, green        the line will go to an open request
// The icon sits inside the name field, at its right end (the screen places it).
// Tapping it explains the state in plain words. For an unmatched line the popup also holds the one action
// that fixes it: pick the request the line was bought for.

import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useLocale } from "@/lib/i18n-context";

export type LineStatusKind = "unmatched" | "check" | "matched";

const LOOK = {
  // The same yellow as the "Check" tags on the other fields.
  unmatched: { icon: "exclamationmark.triangle.fill", fill: COLORS.amberBannerFill, edge: COLORS.amberBorder, ink: COLORS.amberText },
  check: { icon: "info.circle.fill", fill: COLORS.amberBannerFill, edge: COLORS.amberBorder, ink: COLORS.amberText },
  matched: { icon: "checkmark.circle.fill", fill: COLORS.successBg, edge: COLORS.success, ink: COLORS.success },
} as const;

type ButtonProps = { kind: LineStatusKind; label: string; onPress: () => void };

/** The icon inside the line name field. Looks small; hitSlop brings the tap area up to the minimum size. */
export function LineStatusButton({ kind, label, onPress }: ButtonProps) {
  const look = LOOK[kind];
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.badge, { backgroundColor: look.fill, borderColor: look.edge }]}>
        <IconSymbol name={look.icon} size={18} color={look.ink} />
      </View>
    </Pressable>
  );
}

type DialogProps = {
  /** null keeps the popup closed. */
  kind: LineStatusKind | null;
  /** What the line is called now. */
  lineName: string;
  /** The request the line matches, when it does. */
  requestName?: string;
  /** The scan was also unsure of this line (shown under the "not matched" explanation). */
  alsoCheck?: boolean;
  /** False when no request is open at all: there is nothing to pick from. */
  hasRequests: boolean;
  onMatch: () => void;
  onClose: () => void;
};

export function LineStatusDialog({ kind, lineName, requestName, alsoCheck, hasRequests, onMatch, onClose }: DialogProps) {
  const { t } = useLocale();
  if (!kind) return null;
  const look = LOOK[kind];
  const title = t(kind === "unmatched" ? "rv.status_unmatched_title" : kind === "check" ? "rv.status_check_title" : "rv.status_matched_title");
  const body =
    kind === "unmatched"
      ? t(hasRequests ? "rv.status_unmatched_body" : "rv.unmatched_none", { line: lineName })
      : kind === "check"
        ? t("rv.status_check_body")
        : t("rv.status_matched_body", { request: requestName ?? lineName });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.center}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t("rv.status_close")} />
        <View style={styles.card} accessibilityViewIsModal>
          <View style={[styles.cardBadge, { backgroundColor: look.fill, borderColor: look.edge }]}>
            <IconSymbol name={look.icon} size={26} color={look.ink} />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          {kind === "unmatched" && hasRequests ? <Text style={styles.hint}>{t("rv.status_unmatched_hint")}</Text> : null}
          {kind === "unmatched" && alsoCheck ? <Text style={styles.hint}>{t("rv.status_check_body")}</Text> : null}

          {kind === "unmatched" && hasRequests ? (
            <Pressable onPress={onMatch} style={({ pressed }) => [styles.primary, pressed && styles.pressed]} accessibilityRole="button">
              <Text style={styles.primaryText}>{t("rv.status_match_action")}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onClose} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} accessibilityRole="button">
            <Text style={styles.secondaryText}>{t("rv.status_close")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  hit: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  badge: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.8 },
  center: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 380, backgroundColor: COLORS.card, borderRadius: 18, padding: 20, gap: 10 },
  cardBadge: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  title: { fontSize: 18, fontFamily: FONT.extrabold, color: COLORS.heading },
  body: { fontSize: 14, fontFamily: FONT.regular, color: COLORS.heading, lineHeight: 21 },
  hint: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted, lineHeight: 19 },
  primary: { minHeight: MIN_TAP, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center", marginTop: 6 },
  primaryText: { fontSize: 15, fontFamily: FONT.bold, color: "#FFFFFF" },
  secondary: { minHeight: MIN_TAP, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  secondaryText: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.muted },
});
