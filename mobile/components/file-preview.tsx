import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { COLORS, FONT } from "@/constants/expense-flow-colors";


// Shared file-state shape — imported by index.tsx too, so it only lives here.
export type FileState =
  | { type: "image"; name: string; uri: string; mimeType?: string }
  | { type: "pdf"; name: string; size: string; uri: string; mimeType?: string }
  | null;

/**
 * Renders whichever state the picked file is in:
 * nothing picked yet -> empty state
 * image picked -> thumbnail + filename badge
 * pdf picked -> file icon + name/size row
 */
export function FilePreview({ file }: { file: FileState }) {
  if (!file) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>☁️</Text>
        <Text style={styles.emptyText}>No file chosen yet</Text>
        <Text style={styles.emptySubtext}>
          Tap an option above to attach a file
        </Text>
      </View>
    );
  }

  if (file.type === "image") {
    return (
      <View style={styles.imageWrapper}>
        <Image
          source={{ uri: file.uri }}
          style={styles.image}
          resizeMode="cover"
        />
        <View style={styles.badge}>
          <Text style={styles.badgeText} numberOfLines={1}>
            {file.name}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.pdfRow}>
      <IconSymbol name="doc.fill" size={32} color={COLORS.errorText} />
      <View style={styles.pdfMeta}>
        <Text style={styles.pdfName} numberOfLines={1}>
          {file.name}
        </Text>
        <Text style={styles.pdfSize}>{file.size}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    alignItems: "center",
  },
  emptyIcon: {
    fontSize: 34, fontFamily: FONT.regular,
    marginBottom: 6,
    opacity: 0.5,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: FONT.semibold,
    color: COLORS.muted,
  },
  emptySubtext: {
    fontSize: 11, fontFamily: FONT.regular,
    color: COLORS.muted,
    marginTop: 3,
  },
  imageWrapper: {
    width: "100%",
    height: 280,
    alignItems: "center",
  },
  image: {
    width: "100%",
    height: "100%",
    borderRadius: 12,
  },
  badge: {
    position: "absolute",
    bottom: 8,
    maxWidth: "85%",
    backgroundColor: "rgba(26,26,26,0.72)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  badgeText: {
    color: "#FFF",
    fontSize: 11, fontFamily: FONT.regular,
  },
  pdfRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    padding: 12,
  },
  pdfIcon: {
    fontSize: 28, fontFamily: FONT.regular,
    marginRight: 12,
  },
  pdfMeta: {
    flex: 1,
  },
  pdfName: {
    fontSize: 14,
    fontFamily: FONT.semibold,
    color: COLORS.heading,
  },
  pdfSize: {
    fontSize: 11, fontFamily: FONT.regular,
    color: COLORS.muted,
    marginTop: 2,
  },
});
