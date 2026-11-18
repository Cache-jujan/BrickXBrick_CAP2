import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { COLORS, FONT } from "@/constants/expense-flow-colors";
import { useLocale } from "@/lib/i18n-context";

type Props = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Always visible under the title, never scrolled away (e.g. the main action). */
  top?: React.ReactNode;
  /** The scrolling list. */
  children: React.ReactNode;
  /** Always visible at the bottom, above the safe area (e.g. a Create button). */
  footer?: React.ReactNode;
};

// One bottom sheet for every picker. Two things the old sheets got wrong:
//  - the list is a ScrollView that can SHRINK (flexShrink) inside the height-capped sheet, so the bottom
//    of a long list and any button under it are never clipped off-screen;
//  - the safe area is added as plain padding, not a SafeAreaView inside the Modal, which flickers.
export function BottomSheet({ visible, onClose, title, top, children, footer }: Props) {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t("common.cancel")} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.handle} />
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {top}
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          {footer}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { backgroundColor: COLORS.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 8, maxHeight: "85%", gap: 10 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border },
  title: { fontSize: 18, fontFamily: FONT.extrabold, color: COLORS.heading },
  // flexShrink is what lets the list scroll inside the capped sheet instead of overflowing it.
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { gap: 8, paddingBottom: 4 },
});
