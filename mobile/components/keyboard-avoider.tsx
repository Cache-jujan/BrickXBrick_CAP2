import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, LayoutAnimation, Platform, View, type StyleProp, type ViewStyle } from "react-native";

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  enabled?: boolean;
};

// Lifts its content above the on-screen keyboard.
//
// React Native's KeyboardAvoidingView assumes it starts at the top of the
// window. Below a status bar, a header or the offline strip it does not, so it
// pads too little and the bottom button stays behind the keyboard. This one
// measures where it really sits on screen when the keyboard opens and pads by
// exactly the part of itself the keyboard covers.
//
// That also makes it safe with either Android keyboard mode. If the system
// already shrank the window ("resize"), nothing is covered and no extra
// padding is added; if it did not (edge-to-edge), the covered part is padded.
export function KeyboardAvoider({ children, style, enabled = true }: Props) {
  const ref = useRef<View>(null);
  const [padding, setPadding] = useState(0);
  const ios = Platform.OS === "ios";

  const setAnimated = useCallback(
    (next: number, duration?: number) => {
      if (ios && duration) LayoutAnimation.configureNext(LayoutAnimation.create(Math.max(duration, 10), "keyboard", "opacity"));
      setPadding(next);
    },
    [ios]
  );

  useEffect(() => {
    if (!enabled) {
      setPadding(0);
      return undefined;
    }
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (event) => {
      const keyboardTop = event.endCoordinates.screenY;
      ref.current?.measureInWindow((_x, y, _width, height) => {
        // The part of this view below the top of the keyboard.
        setAnimated(Math.max(0, Math.ceil(y + height - keyboardTop)), event.duration);
      });
    });
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", (event) => setAnimated(0, event?.duration));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [enabled, ios, setAnimated]);

  return (
    <View ref={ref} collapsable={false} style={[{ flex: 1 }, style, { paddingBottom: padding }]}>
      {children}
    </View>
  );
}
