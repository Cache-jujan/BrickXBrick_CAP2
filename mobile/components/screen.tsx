import type { ReactNode, Ref } from "react";
import { Platform, ScrollView, View, type RefreshControlProps, type StyleProp, type ViewStyle } from "react-native";

import { KeyboardAvoider } from "@/components/keyboard-avoider";
import { COLORS } from "@/constants/expense-flow-colors";
import { useKeyboardOpen } from "@/hooks/use-keyboard-open";
import { useScreenInsets } from "@/hooks/use-screen-insets";

type ScreenProps = {
  children: ReactNode;
  // Fixed bar at the top (<FlowHeader>), outside any scrolling.
  header?: ReactNode;
  // Fixed bar at the bottom that clears the home indicator itself (<SmBottomBar>).
  footer?: ReactNode;
  background?: string;
  // Colour behind the status bar, when it differs from the page (e.g. an orange hero).
  topColor?: string;
};

// The one wrapper every screen sits in. It applies the system-bar insets once
// (top and bottom) so no screen adds its own margin, and keeps the header out
// of the scrolling content so the back button never moves or hides.
export function Screen({ children, header, footer, background = COLORS.bg, topColor }: ScreenProps) {
  const insets = useScreenInsets();
  const keyboardOpen = useKeyboardOpen();
  return (
    <View style={{ flex: 1, backgroundColor: background }}>
      <View style={{ height: insets.top, backgroundColor: topColor ?? background }} />
      {header}
      <View style={{ flex: 1 }}>{children}</View>
      {footer ?? <View style={{ height: keyboardOpen ? 0 : insets.bottom }} />}
    </View>
  );
}

type KeyboardScreenProps = Omit<ScreenProps, "footer"> & {
  // A sticky action bar that rides above the keyboard (e.g. the submit button).
  footer?: ReactNode;
  scrollRef?: Ref<ScrollView>;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  contentContainerStyle?: StyleProp<ViewStyle>;
};

// A screen with form fields: the fields scroll, the keyboard never covers the
// field or the buttons, and a tap on a dropdown or button works on the first
// try ("handled") instead of only closing the keyboard.
export function KeyboardScreen({ children, header, footer, background, topColor, scrollRef, refreshControl, contentContainerStyle }: KeyboardScreenProps) {
  return (
    <Screen header={header} background={background} topColor={topColor}>
      <KeyboardAvoider>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={contentContainerStyle}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
        {footer}
      </KeyboardAvoider>
    </Screen>
  );
}
