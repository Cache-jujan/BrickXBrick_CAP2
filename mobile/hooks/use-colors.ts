import { useColorScheme } from "react-native";

import { Colors } from "@/constants/theme";

export function useColors() {
  const colorScheme = useColorScheme();
  return Colors[colorScheme === "dark" ? "dark" : "light"];
}