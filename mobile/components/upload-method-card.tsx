import React from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import { COLORS, FONT } from "@/constants/expense-flow-colors";

type Props = {
  icon: string;
  label: string;
  onPress: () => void;
  fullWidth?: boolean;
};

/**
 * One tappable "Use Camera / From Gallery / Upload PDF" button.
 * fullWidth makes it span the row (used for the PDF option).
 */
export function UploadMethodCard({ icon, label, onPress, fullWidth }: Props) {
  return (
    <TouchableOpacity
      style={[styles.card, fullWidth && styles.cardFullWidth]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    width: "48%",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardFullWidth: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
  },
  icon: {
    fontSize: 22, fontFamily: FONT.regular,
    marginBottom: 6,
  },
  label: {
    fontSize: 13,
    fontFamily: FONT.semibold,
    color: COLORS.heading,
  },
});