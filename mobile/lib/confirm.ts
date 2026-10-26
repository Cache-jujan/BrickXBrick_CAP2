import { Alert } from "react-native";

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  // Red confirm button, for things that throw work away.
  destructive?: boolean;
};

// Asks before a change is made. Resolves true only when the person taps the
// confirm button; Cancel, tapping outside and the Android back button all give false.
export function confirmAction({ title, message, confirmLabel, cancelLabel, destructive }: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: "cancel", onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}
