import { Text, View } from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { captureStyles } from "@/styles/capture-screen.styles";

type DestinationScreenProps = {
  title: string;
  description: string;
  icon: "clock.arrow.circlepath" | "chart.bar.fill" | "gearshape.fill";
};

export function DestinationScreen({ title, description, icon }: DestinationScreenProps) {
  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1" safeAreaClassName="flex-1">
      <View style={captureStyles.destination}>
        <View style={captureStyles.destinationIcon}>
          <IconSymbol name={icon} size={30} color="#B94D22" />
        </View>
        <Text style={captureStyles.destinationTitle}>{title}</Text>
        <Text style={captureStyles.destinationCopy}>{description}</Text>
      </View>
    </ScreenContainer>
  );
}
