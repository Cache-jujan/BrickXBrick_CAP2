import { useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { consumeSessionExpired, login, nextRouteAfterLogin } from "@/lib/auth";
import { COLORS, FONT } from "@/constants/expense-flow-colors";
import { fieldErrorStyle } from "@/components/blocked-reasons";
import { isNetworkError } from "@/lib/sync/messages";
import { useNetwork } from "@/lib/sync/network-context";
import { KeyboardScreen } from "@/components/screen";
import { AppButton } from "@/components/app-button";
import { BrandMark } from "@/components/brand-mark";

const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL?.trim().replace(/\/$/, "");

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Shown once when we got here because the saved sign-in expired.
  const [error, setError] = useState(() =>
    consumeSessionExpired()
      ? "Your sign-in expired. Please sign in again. Anything saved on your phone is kept and will be sent after you sign in."
      : ""
  );
  const { isOnline, syncNow } = useNetwork();
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  // Which fields were empty on the last attempt; they get a red outline.
  const [missing, setMissing] = useState({ email: false, password: false });

  async function handleLogin() {
    const nextMissing = { email: !email.trim(), password: !password };
    setMissing(nextMissing);
    if (nextMissing.email || nextMissing.password) {
      setError(
        nextMissing.email && nextMissing.password
          ? "Enter your email and password to continue."
          : nextMissing.email
            ? "Enter your email address to continue."
            : "Enter your password to continue."
      );
      return;
    }

    setError("");
    setSubmitting(true);
    try {
      const session = await login(email, password);
      // Anything queued while signed out or offline is sent now, not up to 15 s later.
      syncNow();
      // Terms of Use / Privacy Notice first if not yet accepted (app/terms.tsx).
      router.replace(nextRouteAfterLogin(session.user));
    } catch (err) {
      // Never show the phone's raw network error ("fetch failed: java.net...").
      if (isNetworkError(err)) {
        setError(
          isOnline
            ? "Can't reach the Brick x Brick server. Check your internet connection and try again."
            : "You're offline. Connect to the internet to sign in."
        );
      } else {
        setError(err instanceof Error ? err.message : "Unable to sign in right now.");
      }
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
    <KeyboardScreen background={COLORS.bg} contentContainerStyle={styles.content}>
      {/* A faint, oversized copy of the mark behind the form. Decoration only. */}
      <BrandMark size={300} style={styles.watermark} />

      <View style={styles.brand}>
        <BrandMark size={34} />
        <Text style={styles.brandName}>Brick x Brick</Text>
      </View>

      <View style={styles.heading}>
        <Text style={styles.title}>Sign in</Text>
        <Text style={styles.subtitle}>Use the account your System Administrator created for you.</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>Email address</Text>
        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="you@gmail.com"
          placeholderTextColor={COLORS.muted}
          style={[styles.input, missing.email && !email.trim() && fieldErrorStyle]}
          value={email}
          onChangeText={setEmail}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />

        <Text style={[styles.label, styles.labelSpaced]}>Password</Text>
        <View style={[styles.inputRow, missing.password && !password && fieldErrorStyle]}>
          <TextInput
            ref={passwordRef}
            autoCapitalize="none"
            autoComplete="password"
            autoCorrect={false}
            placeholder="Enter your password"
            placeholderTextColor={COLORS.muted}
            secureTextEntry={!showPassword}
            style={styles.inputInRow}
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={handleLogin}
            returnKeyType="go"
          />
          <Pressable
            onPress={() => setShowPassword((value) => !value)}
            hitSlop={8}
            style={styles.showButton}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? "Hide password" : "Show password"}
          >
            <Text style={styles.showPassword}>{showPassword ? "Hide" : "Show"}</Text>
          </Pressable>
        </View>

        <Pressable accessibilityRole="link" onPress={handleForgotPassword} style={styles.forgotPasswordButton}>
          <Text style={styles.forgotPasswordText}>Forgot password?</Text>
        </Pressable>

        {error ? (
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        <AppButton label="Sign in" onPress={handleLogin} loading={submitting} />
      </View>

      <Text style={styles.footer}>© 2026 Brick x Brick</Text>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, overflow: "hidden", paddingBottom: 24, paddingHorizontal: 24, paddingTop: 20 },
  watermark: { opacity: 0.07, position: "absolute", right: -90, top: 70 },
  brand: { alignItems: "center", flexDirection: "row", gap: 10 },
  brandName: { color: COLORS.heading, fontFamily: FONT.extrabold, fontSize: 18 },
  heading: { marginTop: 56 },
  title: { color: COLORS.heading, fontFamily: FONT.extrabold, fontSize: 38, letterSpacing: -1 },
  subtitle: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 15, lineHeight: 22, marginTop: 8, maxWidth: 300 },
  form: { marginTop: 36 },
  label: { color: COLORS.heading, fontFamily: FONT.bold, fontSize: 13, marginBottom: 8 },
  labelSpaced: { marginTop: 18 },
  input: { backgroundColor: COLORS.card, borderColor: COLORS.inputBorder, borderRadius: 14, borderWidth: 1, color: COLORS.heading, fontFamily: FONT.regular, fontSize: 16, minHeight: 54, paddingHorizontal: 16 },
  inputRow: { alignItems: "center", backgroundColor: COLORS.card, borderColor: COLORS.inputBorder, borderRadius: 14, borderWidth: 1, flexDirection: "row", minHeight: 54 },
  inputInRow: { color: COLORS.heading, flex: 1, fontFamily: FONT.regular, fontSize: 16, minHeight: 52, paddingHorizontal: 16 },
  showButton: { justifyContent: "center", minHeight: 52, paddingHorizontal: 16 },
  showPassword: { color: COLORS.primary, fontFamily: FONT.bold, fontSize: 13 },
  forgotPasswordButton: { alignSelf: "flex-start", marginBottom: 22, marginTop: 14, minHeight: 32, justifyContent: "center" },
  forgotPasswordText: { color: COLORS.primary, fontFamily: FONT.bold, fontSize: 13 },
  error: { backgroundColor: COLORS.errorFill, borderRadius: 10, color: COLORS.errorText, fontFamily: FONT.medium, fontSize: 13, lineHeight: 19, marginBottom: 14, padding: 12 },
  footer: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 12, marginTop: "auto", paddingTop: 28, textAlign: "center" },
});
