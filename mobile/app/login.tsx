import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { login } from "@/lib/auth";
import { COLORS } from "@/constants/expense-flow-colors";

const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL?.trim().replace(/\/$/, "");

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  async function handleLogin() {
    if (!email.trim() || !password) {
      setError("Enter your email and password to continue.");
      return;
    }

    setError("");
    setSubmitting(true);
    try {
      const session = await login(email, password);
      router.replace(session.user.role === "Site Manager" ? "/site-manager" : "/(tabs)");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in right now.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgotPassword() {
    if (!WEB_URL) {
      setError("Password recovery isn't configured yet. Add EXPO_PUBLIC_WEB_URL to mobile/.env.");
      return;
    }

    try {
      await Linking.openURL(`${WEB_URL}/forgot-password`);
    } catch {
      setError("Unable to open the password recovery page right now.");
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <View style={styles.brandBrickLight} />
              <View style={styles.brandBrickDark} />
              <View style={styles.brandBrickAccent} />
            </View>
            <Text style={styles.brandName}>Brick x Brick</Text>
          </View>

          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.subtitle}>Use your Brick x Brick account.</Text>

          <View style={styles.card}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email address</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="you@gmail.com"
                placeholderTextColor={COLORS.muted}
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
            </View>

            <View style={styles.fieldGroup}>
              <View style={styles.labelRow}>
                <Text style={[styles.label, styles.labelInRow]}>Password</Text>
                <Pressable onPress={() => setShowPassword((value) => !value)} hitSlop={8}>
                  <Text style={styles.showPassword}>{showPassword ? "Hide" : "Show"}</Text>
                </Pressable>
              </View>
              <TextInput
                ref={passwordRef}
                autoCapitalize="none"
                autoComplete="password"
                autoCorrect={false}
                placeholder="Enter your password"
                placeholderTextColor={COLORS.muted}
                secureTextEntry={!showPassword}
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={handleLogin}
                returnKeyType="go"
              />
            </View>

            <Pressable
              accessibilityRole="link"
              onPress={handleForgotPassword}
              style={styles.forgotPasswordButton}
            >
              <Text style={styles.forgotPasswordText}>Forgot password?</Text>
            </Pressable>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              accessibilityRole="button"
              disabled={submitting}
              onPress={handleLogin}
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, submitting && styles.buttonDisabled]}
            >
              {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Sign in</Text>}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: "#F8F1E8" },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 24 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 22 },
  brandMark: { height: 22, width: 28, position: "relative" },
  brandBrickLight: { position: "absolute", left: 0, top: 0, width: 13, height: 9, borderRadius: 2, backgroundColor: "#D8C7AA" },
  brandBrickDark: { position: "absolute", right: 0, top: 0, width: 13, height: 9, borderRadius: 2, backgroundColor: "#1A1A1A" },
  brandBrickAccent: { position: "absolute", left: 7, bottom: 0, width: 13, height: 9, borderRadius: 2, backgroundColor: COLORS.primary },
  brandName: { color: "#1A1A1A", fontSize: 15, fontWeight: "800", letterSpacing: 0.3 },
  title: { color: "#1A1A1A", fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: COLORS.muted, fontSize: 14, marginTop: 4 },
  card: { backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 18, borderWidth: 1, marginTop: 18, padding: 18, shadowColor: "#5B4636", shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  fieldGroup: { marginBottom: 16 },
  labelRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 7 },
  label: { color: COLORS.heading, fontSize: 13, fontWeight: "700", marginBottom: 7 },
  // Inside labelRow the row already provides the bottom spacing.
  labelInRow: { marginBottom: 0 },
  showPassword: { color: COLORS.primary, fontSize: 12, fontWeight: "700" },
  forgotPasswordButton: { alignSelf: "flex-end", marginBottom: 16, marginTop: -8 },
  forgotPasswordText: { color: COLORS.primary, fontSize: 13, fontWeight: "700" },
  input: { backgroundColor: "#FFFCF8", borderColor: "#E7DDCF", borderRadius: 12, borderWidth: 1, color: COLORS.heading, fontSize: 15, paddingHorizontal: 14, paddingVertical: 13 },
  error: { color: "#B42318", fontSize: 13, lineHeight: 19, marginBottom: 14 },
  button: { alignItems: "center", backgroundColor: COLORS.primary, borderRadius: 13, justifyContent: "center", minHeight: 50, paddingHorizontal: 18 },
  buttonPressed: { opacity: 0.86 },
  buttonDisabled: { opacity: 0.65 },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
});
