import { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

export default function OAuthCallbackScreen() {
  const params = useLocalSearchParams<{ code?: string; error?: string }>();

  useEffect(() => {
    if (params.error || params.code) {
      // TODO: exchange params.code for a session once your backend is ready
      router.replace("/(tabs)");
    }
  }, [params.code, params.error]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="large" />
      <Text style={{ marginTop: 12 }}>Signing you in…</Text>
    </View>
  );
}