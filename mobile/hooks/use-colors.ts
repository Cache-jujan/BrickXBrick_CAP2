import { useColorScheme } from "react-native";

import { Colors } from "@/constants/theme";

export function useColors() {
  const colorScheme = useColorScheme() ?? "light";

  return Colors[colorScheme];
}