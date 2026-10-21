import { useRef, useState } from "react";
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
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
  const { isOnline } = useNetwork();
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
    <KeyboardScreen topColor={COLORS.primary} contentContainerStyle={styles.content}>
      {/* The sign-in form scrolls and rides above the keyboard (components/screen). */}
      <>
          <View style={styles.hero}>
            <BrandMark size={64} white />
            <Text style={styles.heroName}>Brick x Brick</Text>
            <Text style={styles.heroTagline}>Build Today. Better Tomorrow.</Text>
          </View>

          <View style={styles.heading}>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Sign in with your Brick x Brick account.</Text>
          </View>

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
                style={[styles.input, missing.email && !email.trim() && fieldErrorStyle]}
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
                style={[styles.input, missing.password && !password && fieldErrorStyle]}
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

            {error ? (
              <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}

            <AppButton label="Sign in" onPress={handleLogin} loading={submitting} />
          </View>
          <Text style={styles.footer}>© 2026 Brick x Brick</Text>
      </>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  content: { flexGrow: 1, paddingBottom: 24 },
  // Orange block at the top: the mark, the name and the tagline.
  hero: { alignItems: "center", backgroundColor: COLORS.primary, borderBottomLeftRadius: 36, borderBottomRightRadius: 36, paddingBottom: 56, paddingTop: 36 },
  heroName: { color: "#FFFFFF", fontFamily: FONT.extrabold, fontSize: 26, letterSpacing: -0.3, marginTop: 16 },
  heroTagline: { color: "rgba(255,255,255,0.85)", fontFamily: FONT.medium, fontSize: 13, marginTop: 4 },
  heading: { marginHorizontal: 24, marginTop: 26 },
  title: { color: COLORS.heading, fontSize: 26, fontFamily: FONT.extrabold, letterSpacing: -0.5 },
  subtitle: { color: COLORS.muted, fontSize: 14, fontFamily: FONT.regular, marginTop: 4 },
  footer: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 12, marginTop: 22, textAlign: "center" },
  card: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderRadius: 20, borderWidth: 1, marginHorizontal: 24, marginTop: 18, padding: 18, shadowColor: "#5B4636", shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  fieldGroup: { marginBottom: 16 },
  labelRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 7 },
  label: { color: COLORS.heading, fontSize: 13, fontFamily: FONT.bold, marginBottom: 7 },
  // Inside labelRow the row already provides the bottom spacing.
  labelInRow: { marginBottom: 0 },
  showPassword: { color: COLORS.primary, fontSize: 12, fontFamily: FONT.bold },
  forgotPasswordButton: { alignSelf: "flex-end", marginBottom: 16, marginTop: -8 },
  forgotPasswordText: { color: COLORS.primary, fontSize: 13, fontFamily: FONT.bold },
  input: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderRadius: 12, borderWidth: 1, color: COLORS.heading, fontSize: 15, fontFamily: FONT.regular, paddingHorizontal: 14, paddingVertical: 13 },
  error: { color: COLORS.errorText, fontSize: 13, fontFamily: FONT.regular, lineHeight: 19, marginBottom: 14 },
});
