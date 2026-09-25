import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brandMark}>
            <View style={styles.brandBrickLight} />
            <View style={styles.brandBrickDark} />
            <View style={styles.brandBrickAccent} />
          </View>

          <Text style={styles.eyebrow}>BRICK X BRICK</Text>
          <Text style={styles.title}>Welcome back.</Text>
          <Text style={styles.subtitle}>
            Sign in to manage your project work and expenses.
          </Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign in</Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email address</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="you@brickxbrick.com"
                placeholderTextColor={COLORS.muted}
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                returnKeyType="next"
              />
            </View>

            <View style={styles.fieldGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Password</Text>
                <Pressable onPress={() => setShowPassword((value) => !value)} hitSlop={8}>
                  <Text style={styles.showPassword}>{showPassword ? "Hide" : "Show"}</Text>
                </Pressable>
              </View>
              <TextInput
                autoCapitalize="none"
                autoComplete="password"
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

          <Text style={styles.footer}>Use your Brick x Brick account credentials.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: "#F8F1E8" },
  content: { flexGrow: 1, justifyContent: "center", padding: 24 },
  brandMark: { height: 42, width: 54, position: "relative", marginBottom: 28 },
  brandBrickLight: { position: "absolute", left: 0, top: 0, width: 25, height: 17, borderRadius: 4, backgroundColor: "#D8C7AA" },
  brandBrickDark: { position: "absolute", right: 0, top: 0, width: 25, height: 17, borderRadius: 4, backgroundColor: "#1A1A1A" },
  brandBrickAccent: { position: "absolute", left: 14, bottom: 0, width: 25, height: 17, borderRadius: 4, backgroundColor: COLORS.primary },
  eyebrow: { color: COLORS.primary, fontSize: 12, fontWeight: "800", letterSpacing: 1.8, marginBottom: 8 },
  title: { color: "#1A1A1A", fontSize: 34, fontWeight: "800", letterSpacing: -0.8 },
  subtitle: { color: COLORS.muted, fontSize: 15, lineHeight: 22, marginTop: 10, maxWidth: 310 },
  card: { backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 20, borderWidth: 1, marginTop: 30, padding: 20, shadowColor: "#5B4636", shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  cardTitle: { color: COLORS.heading, fontSize: 20, fontWeight: "800", marginBottom: 22 },
  fieldGroup: { marginBottom: 16 },
  labelRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 7 },
  label: { color: COLORS.heading, fontSize: 13, fontWeight: "700", marginBottom: 7 },
  showPassword: { color: COLORS.primary, fontSize: 12, fontWeight: "700" },
  input: { backgroundColor: "#FFFCF8", borderColor: "#E7DDCF", borderRadius: 12, borderWidth: 1, color: COLORS.heading, fontSize: 15, paddingHorizontal: 14, paddingVertical: 13 },
  error: { color: "#B42318", fontSize: 13, lineHeight: 19, marginBottom: 14 },
  button: { alignItems: "center", backgroundColor: COLORS.primary, borderRadius: 13, justifyContent: "center", minHeight: 50, paddingHorizontal: 18 },
  buttonPressed: { opacity: 0.86 },
  buttonDisabled: { opacity: 0.65 },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  footer: { color: COLORS.muted, fontSize: 12, marginTop: 22, textAlign: "center" },
});
