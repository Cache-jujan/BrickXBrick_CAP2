// Colors and fonts shared by the Purchaser screens (and the Site Manager ones
// that reuse them). Keep every hex value here, not in the screens.
export const COLORS = {
  primary: "#C4500B", primaryTint: "#FFF1E6", primaryTintText: "#8F3705",
  bg: "#F6F7F9", card: "#FFFFFF",
  // The warm page background the Site Manager screens already use.
  bgWarm: "#F8F1E8", border: "#E6E8EC", inputBorder: "#C9CDD5",
  heading: "#1B1F27", muted: "#565D6B",
  success: "#1B5E32", successBg: "#E3F4E8",
  // Amber: a field the scan wasn't sure about, or a notice to read.
  amberFill: "#FFF8E1", amberBorder: "#D9A400", amberText: "#7A4B00",
  amberBannerFill: "#FFF4D6", amberBannerText: "#5E3A00",
  // Red: an error or a missing required value.
  errorFill: "#FDECEA", errorBorder: "#B3261E", errorText: "#A3231B",
  // Blue chip: "In progress".
  infoFill: "#E6ECF8", infoText: "#243F7A",
};

// One family per weight: React Native can't pick a weight from a custom font.
export const FONT = {
  regular: "PlusJakartaSans_400Regular",
  medium: "PlusJakartaSans_500Medium",
  semibold: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
  extrabold: "PlusJakartaSans_800ExtraBold",
};

// Smallest comfortable tap target (px).
export const MIN_TAP = 44;
