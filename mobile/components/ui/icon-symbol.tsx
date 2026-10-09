// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { SymbolWeight, SymbolViewProps } from "expo-symbols";
import type { ComponentProps } from "react";
import type {
  OpaqueColorValue,
  StyleProp,
  TextStyle,
} from "react-native";

type IconMapping = Partial<
  Record<
    Extract<SymbolViewProps["name"], string>,
    ComponentProps<typeof MaterialIcons>["name"]
  >
>;

const MAPPING = {
  "house.fill": "home",
  "camera.fill": "photo-camera",
  "photo.on.rectangle": "photo-library",
  "doc.fill": "picture-as-pdf",
  "clock.arrow.circlepath": "history",
  "chart.bar.fill": "bar-chart",
  "gearshape.fill": "settings",
  "paperplane.fill": "send",
  "chevron.left.forwardslash.chevron.right": "code",
  "chevron.right": "chevron-right",
  "chevron.left": "chevron-left",
  "arrow.triangle.2.circlepath": "autorenew",
  "exclamationmark.triangle.fill": "warning",
  "checkmark.seal.fill": "verified",
  "person.crop.circle": "account-circle",
} satisfies IconMapping;

type IconSymbolName = keyof typeof MAPPING;

/**
 * Uses native SF Symbols on iOS and Material Icons on Android and web.
 * Icon names are based on SF Symbols and mapped to Material Icons here.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return (
    <MaterialIcons
      color={color}
      size={size}
      name={MAPPING[name]}
      style={style}
    />
  );
}
