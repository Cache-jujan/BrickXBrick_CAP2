import { Image, type StyleProp, type ImageStyle } from "react-native";

// The Brick x Brick mark (orange and charcoal blocks, or all white on an orange
// background). `size` is its height.
export function BrandMark({ size = 32, style, white }: { size?: number; style?: StyleProp<ImageStyle>; white?: boolean }) {
  return (
    <Image
      source={white ? require("../assets/images/logo-mark-white.png") : require("../assets/images/logo-mark.png")}
      style={[{ height: size, width: Math.round((size * 600) / 514) }, style]}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
      accessibilityLabel="Brick x Brick"
    />
  );
}
