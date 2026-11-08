import { useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";

import { consumeSessionExpired, login, nextRouteAfterLogin } from "@/lib/auth";
import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { fieldErrorStyle } from "@/components/blocked-reasons";
import { isNetworkError } from "@/lib/sync/messages";
import { useNetwork } from "@/lib/sync/network-context";
import { KeyboardScreen } from "@/components/screen";
import { AppButton } from "@/components/app-button";
import { BrandMark } from "@/components/brand-mark";
import { LanguageButton } from "@/components/language-button";
import { useLocale } from "@/lib/i18n-context";

const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL?.trim().replace(/\/$/, "");

// Same idea as the web sign-in: a charcoal brand panel on top and the form on a
// light sheet that overlaps it with rounded corners. No photo, no illustration.
export default function LoginScreen() {
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Shown once when we got here because the saved sign-in expired.
  const [error, setError] = useState(() =>
    consumeSessionExpired()
      ? t("lg.expired")
      : ""
  );
  const { isOnline, syncNow } = useNetwork();
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  // Which fields were empty on the last attempt; they get a red outline.
  const [missing, setMissing] = useState({ email: false, password: false });
  // The field being typed in gets the brand outline.
  const [focused, setFocused] = useState<"email" | "password" | null>(null);

  async function handleLogin() {
    const nextMissing = { email: !email.trim(), password: !password };
    setMissing(nextMissing);
    if (nextMissing.email || nextMissing.password) {
      setError(
        nextMissing.email && nextMissing.password
          ? t("lg.need_both")
          : nextMissing.email
            ? t("lg.need_email")
            : t("lg.need_password")
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
          isOnline ? t("lg.err_server") : t("lg.err_offline")
        );
      } else {
        setError(err instanceof Error ? err.message : t("lg.err_signin"));
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
      setError(t("lg.err_recovery_open"));
    }
  }

  return (
    <KeyboardScreen background={COLORS.dark} topColor={COLORS.dark} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        {/* A faint, oversized copy of the mark behind the headline. Decoration only. */}
        <BrandMark size={220} white style={styles.watermark} />
        <View style={styles.brandRow}>
          <View style={styles.brandLeft}>
            <BrandMark size={30} white />
            <Text style={styles.brandName}>
              Brick <Text style={styles.brandX}>x</Text> Brick
            </Text>
          </View>
          <LanguageButton color="#FFFFFF" />
        </View>
        <Text style={styles.headline}>
          {t("login.story_lead")} <Text style={styles.headlineAccent}>{t("login.story_accent")}</Text>
        </Text>
        <View style={styles.rule} />
      </View>

      <View style={styles.sheet}>
        <Text style={styles.title}>{t("login.welcome")}</Text>
        <Text style={styles.subtitle}>{t("login.subtitle")}</Text>

        <Text style={styles.label}>{t("login.email")}</Text>
        <View style={[styles.field, focused === "email" && styles.fieldFocus, missing.email && !email.trim() && fieldErrorStyle]}>
          <Feather name="mail" size={18} color={COLORS.muted} style={styles.fieldIcon} />
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="you@gmail.com"
            placeholderTextColor={COLORS.muted}
            style={styles.fieldInput}
            value={email}
            onChangeText={setEmail}
            onFocus={() => setFocused("email")}
            onBlur={() => setFocused(null)}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
        </View>

        <Text style={[styles.label, styles.labelSpaced]}>{t("login.password")}</Text>
        <View style={[styles.field, focused === "password" && styles.fieldFocus, missing.password && !password && fieldErrorStyle]}>
          <Feather name="lock" size={18} color={COLORS.muted} style={styles.fieldIcon} />
          <TextInput
            ref={passwordRef}
            autoCapitalize="none"
            autoComplete="password"
            autoCorrect={false}
            placeholder={t("login.enter_password")}
            placeholderTextColor={COLORS.muted}
            secureTextEntry={!showPassword}
            style={styles.fieldInput}
            value={password}
            onChangeText={setPassword}
            onFocus={() => setFocused("password")}
            onBlur={() => setFocused(null)}
            onSubmitEditing={handleLogin}
            returnKeyType="go"
          />
          <Pressable
            onPress={() => setShowPassword((value) => !value)}
            hitSlop={6}
            style={styles.showButton}
            accessibilityRole="button"
            accessibilityLabel={t(showPassword ? "login.hide" : "login.show")}
          >
            <Feather name={showPassword ? "eye-off" : "eye"} size={20} color={COLORS.muted} />
          </Pressable>
        </View>

        <Pressable accessibilityRole="link" onPress={handleForgotPassword} style={styles.forgot}>
          <Text style={styles.forgotText}>{t("login.forgot")}</Text>
        </Pressable>

        {error ? (
          <View style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Feather name="alert-circle" size={18} color={COLORS.errorText} style={styles.errorIcon} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <AppButton
          label={submitting ? t("login.signing_in") : t("login.title")}
          onPress={handleLogin}
          loading={submitting}
          style={styles.submit}
          trailing={<Feather name="arrow-right" size={18} color="#FFFFFF" />}
        />

        {/* Just a link to read them. Agreeing happens once, on the terms
            screen after the first sign-in (app/terms.tsx), and is saved on
            the server, so it is not asked again on every sign-in. */}
        <Pressable accessibilityRole="link" onPress={() => router.push("/terms")} style={styles.legal}>
          <Text style={styles.legalText}>{t("account.terms_privacy")}</Text>
        </Pressable>

        <Text style={styles.footer}>© 2026 Brick x Brick</Text>
      </View>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },

  hero: { overflow: "hidden", paddingBottom: 52, paddingHorizontal: 24, paddingTop: 8 },
  watermark: { opacity: 0.06, position: "absolute", right: -60, top: 30 },
  brandRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  brandLeft: { alignItems: "center", flexDirection: "row", gap: 10 },
  brandName: { color: "#FFFFFF", fontFamily: FONT.bold, fontSize: 20, letterSpacing: -0.3 },
  brandX: { color: COLORS.accentLight },
  headline: { color: "#FFFFFF", fontFamily: FONT.extrabold, fontSize: 27, letterSpacing: -0.6, lineHeight: 33, marginTop: 28, maxWidth: 330 },
  headlineAccent: { color: COLORS.accentLight },
  rule: { backgroundColor: COLORS.accentLight, borderRadius: 2, height: 4, marginTop: 18, width: 48 },

  sheet: { backgroundColor: COLORS.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, flexGrow: 1, marginTop: -28, paddingBottom: 20, paddingHorizontal: 24, paddingTop: 28 },
  title: { color: COLORS.heading, fontFamily: FONT.extrabold, fontSize: 28, letterSpacing: -0.6 },
  subtitle: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 15, lineHeight: 22, marginBottom: 24, marginTop: 6 },

  label: { color: COLORS.heading, fontFamily: FONT.bold, fontSize: 13, marginBottom: 8 },
  labelSpaced: { marginTop: 18 },
  field: { alignItems: "center", backgroundColor: COLORS.card, borderColor: COLORS.inputBorder, borderRadius: 14, borderWidth: 1, flexDirection: "row", minHeight: 54 },
  fieldFocus: { borderColor: COLORS.primary, borderWidth: 1.5 },
  fieldIcon: { marginLeft: 16 },
  fieldInput: { color: COLORS.heading, flex: 1, fontFamily: FONT.regular, fontSize: 16, minHeight: 52, paddingHorizontal: 12 },
  showButton: { alignItems: "center", justifyContent: "center", minHeight: MIN_TAP, minWidth: MIN_TAP },

  forgot: { alignSelf: "flex-end", justifyContent: "center", marginBottom: 6, marginTop: 6, minHeight: MIN_TAP },
  forgotText: { color: COLORS.primary, fontFamily: FONT.bold, fontSize: 14 },

  error: { alignItems: "flex-start", backgroundColor: COLORS.errorFill, borderColor: COLORS.errorBorder, borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 14, padding: 12 },
  errorIcon: { marginTop: 1 },
  errorText: { color: COLORS.errorText, flex: 1, fontFamily: FONT.medium, fontSize: 14, lineHeight: 20 },

  submit: { minHeight: 54 },

  legal: { alignItems: "center", justifyContent: "center", marginTop: 14, minHeight: MIN_TAP },
  legalText: { color: COLORS.muted, fontFamily: FONT.semibold, fontSize: 13, textDecorationLine: "underline" },
  footer: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 12, marginTop: "auto", paddingTop: 16, textAlign: "center" },
});
