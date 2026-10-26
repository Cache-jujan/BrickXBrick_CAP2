import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect, router } from "expo-router";

import { AppButton } from "@/components/app-button";
import { FlowHeader } from "@/components/flow-header";
import { KeyboardScreen } from "@/components/screen";
import { COLORS, FONT } from "@/constants/expense-flow-colors";
import { updateUsername } from "@/lib/api";
import { getSession, setUsername } from "@/lib/auth";
import { confirmAction } from "@/lib/confirm";
import { useLocale } from "@/lib/i18n-context";

const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/;

export default function UsernameScreen() {
  const { t } = useLocale();
  const session = getSession();
  const saved = session?.user.username ?? "";
  const [value, setValue] = useState(saved);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  if (!session) return <Redirect href="/login" />;

  const next = value.trim();
  const valid = USERNAME_RE.test(next);
  const changed = next !== saved;
  const label = `${next || "username"}.${session.user.role.toLowerCase().replace(/\s+/g, "-")}`;

  async function leave() {
    if (changed && !(await confirmAction({
      title: t("settings.discard_title"),
      message: t("settings.discard_body"),
      confirmLabel: t("settings.discard_yes"),
      cancelLabel: t("settings.keep_editing"),
      destructive: true,
    }))) return;
    router.back();
  }

  async function save() {
    if (!valid) return setError(t("settings.username_invalid"));
    const ok = await confirmAction({
      title: t("settings.confirm_username_title"),
      message: t("settings.confirm_username_body", { label }),
      confirmLabel: t("settings.confirm_yes"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    setSaving(true);
    setError("");
    try {
      const result = await updateUsername(next);
      setUsername(result.username, result.name);
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.username_invalid"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardScreen
      header={<FlowHeader title={t("settings.row_username")} onBack={leave} fallback="/settings" />}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.label}>{t("settings.row_username")}</Text>
      <TextInput
        value={value}
        onChangeText={(v) => { setValue(v); setError(""); }}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        maxLength={30}
        placeholder={t("settings.row_username")}
        placeholderTextColor={COLORS.muted}
        style={[styles.input, !!error && styles.inputError]}
        returnKeyType="done"
        onSubmitEditing={() => { if (valid && changed) save(); }}
      />
      <Text style={styles.hint}>{t("settings.username_hint", { label })}</Text>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <View style={styles.action}>
        <AppButton label={t("settings.save")} onPress={save} loading={saving} disabled={!valid || !changed} />
      </View>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  label: { color: COLORS.heading, fontFamily: FONT.bold, fontSize: 13, marginBottom: 8 },
  input: { backgroundColor: COLORS.card, borderColor: COLORS.inputBorder, borderRadius: 14, borderWidth: 1, color: COLORS.heading, fontFamily: FONT.regular, fontSize: 16, minHeight: 54, paddingHorizontal: 16 },
  inputError: { borderColor: COLORS.errorText },
  hint: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 13, lineHeight: 19, marginTop: 8 },
  error: { color: COLORS.errorText, fontFamily: FONT.medium, fontSize: 13, marginTop: 8 },
  action: { marginTop: 24 },
});
