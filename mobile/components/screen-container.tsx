import type { ReactNode } from "react";
import { SafeAreaView, View } from "react-native";

type ScreenContainerProps = {
  children: ReactNode;
  containerClassName?: string;
  className?: string;
  safeAreaClassName?: string;
};

export function ScreenContainer({
  children,
  containerClassName = "",
  className = "",
  safeAreaClassName = "",
}: ScreenContainerProps) {
  return (
    <View>
      <SafeAreaView>
        <View>{children}</View>
      </SafeAreaView>
    </View>
  );
}