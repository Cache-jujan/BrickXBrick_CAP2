import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect, router } from "expo-router";

import { AppButton } from "@/components/app-button";
import { FlowHeader } from "@/components/flow-header";
import { KeyboardScreen } from "@/components/screen";
import { COLORS, FONT } from "@/constants/expense-flow-colors";
import { changePassword } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { confirmAction } from "@/lib/confirm";
import { useLocale } from "@/lib/i18n-context";

export default function PasswordScreen() {
  const { t } = useLocale();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  if (!getSession()) return <Redirect href="/login" />;

  const dirty = !!(current || next || confirm);
  const ready = !!current && next.length >= 8 && next === confirm;

  async function leave() {
    if (dirty && !(await confirmAction({
      title: t("settings.discard_title"),
      message: t("settings.discard_body"),
      confirmLabel: t("settings.discard_yes"),
      cancelLabel: t("settings.keep_editing"),
      destructive: true,
    }))) return;
    router.back();
  }

  async function save() {
    if (next.length < 8) return setError(t("settings.password_short"));
    if (next !== confirm) return setError(t("settings.password_mismatch"));
    const ok = await confirmAction({
      title: t("settings.confirm_password_title"),
      message: t("settings.confirm_password_body"),
      confirmLabel: t("settings.confirm_yes"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    setSaving(true);
    setError("");
    try {
      await changePassword(current, next);
      // Blank the fields first so going back doesn't ask to discard what was just saved.
      setCurrent("");
      setNext("");
      setConfirm("");
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.password_short"));
    } finally {
      setSaving(false);
    }
  }

  function field(label: string, value: string, set: (v: string) => void, autoComplete: "current-password" | "new-password") {
    return (
      <>
        <Text style={styles.label}>{label}</Text>
        <TextInput
          value={value}
          onChangeText={(v) => { set(v); setError(""); }}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={autoComplete}
          placeholder={label}
          placeholderTextColor={COLORS.muted}
          style={styles.input}
        />
      </>
    );
  }

  return (
    <KeyboardScreen
      header={<FlowHeader title={t("settings.row_password")} onBack={leave} fallback="/settings" />}
      contentContainerStyle={styles.content}
    >
      {field(t("settings.current_password"), current, setCurrent, "current-password")}
      {field(t("settings.new_password"), next, setNext, "new-password")}
      {field(t("settings.confirm_password"), confirm, setConfirm, "new-password")}
      <Pressable onPress={() => setShow((v) => !v)} hitSlop={8} style={styles.toggle} accessibilityRole="button">
        <Text style={styles.toggleText}>{t(show ? "login.hide" : "login.show")}</Text>
      </Pressable>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <View style={styles.action}>
        <AppButton label={t("settings.save")} onPress={save} loading={saving} disabled={!ready} />
      </View>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  label: { color: COLORS.heading, fontFamily: FONT.bold, fontSize: 13, marginBottom: 8, marginTop: 16 },
  input: { backgroundColor: COLORS.card, borderColor: COLORS.inputBorder, borderRadius: 14, borderWidth: 1, color: COLORS.heading, fontFamily: FONT.regular, fontSize: 16, minHeight: 54, paddingHorizontal: 16 },
  toggle: { alignSelf: "flex-start", marginTop: 12, minHeight: 32, justifyContent: "center" },
  toggleText: { color: COLORS.primary, fontFamily: FONT.bold, fontSize: 13 },
  error: { color: COLORS.errorText, fontFamily: FONT.medium, fontSize: 13, marginTop: 8 },
  action: { marginTop: 24 },
});
