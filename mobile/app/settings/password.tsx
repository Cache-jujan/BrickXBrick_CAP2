import { useState } from "react";
import { StyleSheet, Switch, Text, TextInput, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Redirect, router } from "expo-router";

import { AppButton } from "@/components/app-button";
import { FlowHeader } from "@/components/flow-header";
import { KeyboardScreen } from "@/components/screen";
import { COLORS, FONT } from "@/constants/expense-flow-colors";
import { changePassword } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { confirmAction } from "@/lib/confirm";
import { useLocale } from "@/lib/i18n-context";
import { PASSWORD_RULES, passwordMeetsRules } from "@/lib/password-rules";

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
  const ready = !!current && passwordMeetsRules(next) && next === confirm;
  const mismatch = confirm.length > 0 && next !== confirm;

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
    if (!passwordMeetsRules(next)) return setError(t("pw.rules_not_met"));
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
        <View style={styles.inputRow}>
          <MaterialIcons name="lock-outline" size={20} color={COLORS.muted} />
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
        </View>
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
      <View style={styles.rules}>
        <Text style={styles.rulesTitle}>{t("pw.requirements")}</Text>
        {PASSWORD_RULES.map((rule) => {
          const ok = rule.test(next);
          return (
            <View key={rule.id} style={styles.rule} accessible accessibilityLabel={`${t(rule.labelKey)}, ${t(ok ? "pw.met" : "pw.not_met")}`}>
              <MaterialIcons name={ok ? "check-circle" : "radio-button-unchecked"} size={18} color={ok ? COLORS.success : COLORS.muted} />
              <Text style={[styles.ruleText, ok && styles.ruleOk]}>{t(rule.labelKey)}</Text>
            </View>
          );
        })}
      </View>
      {field(t("settings.confirm_password"), confirm, setConfirm, "new-password")}
      {mismatch ? <Text style={styles.error} accessibilityRole="alert">{t("pw.must_match")}</Text> : null}
      <View style={styles.showRow}>
        <Text style={styles.showText}>{t("pw.show_passwords")}</Text>
        <Switch
          value={show}
          onValueChange={setShow}
          trackColor={{ true: COLORS.primary, false: COLORS.inputBorder }}
          accessibilityLabel={t("pw.show_passwords")}
        />
      </View>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <View style={styles.action}>
        <AppButton label={t("pw.update")} onPress={save} loading={saving} disabled={!ready} />
      </View>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  label: { color: COLORS.heading, fontFamily: FONT.bold, fontSize: 13, marginBottom: 8, marginTop: 16 },
  inputRow: { alignItems: "center", backgroundColor: COLORS.card, borderColor: COLORS.inputBorder, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 10, minHeight: 54, paddingHorizontal: 16 },
  input: { color: COLORS.heading, flex: 1, fontFamily: FONT.regular, fontSize: 16, minHeight: 52 },
  rules: { backgroundColor: COLORS.primaryTint, borderRadius: 14, gap: 6, marginTop: 12, padding: 14 },
  rulesTitle: { color: COLORS.primaryTintText, fontFamily: FONT.bold, fontSize: 13, marginBottom: 2 },
  rule: { alignItems: "center", flexDirection: "row", gap: 8 },
  ruleText: { color: COLORS.muted, fontFamily: FONT.medium, fontSize: 13 },
  ruleOk: { color: COLORS.success },
  showRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 16 },
  showText: { color: COLORS.heading, fontFamily: FONT.medium, fontSize: 14 },
  error: { color: COLORS.errorText, fontFamily: FONT.medium, fontSize: 13, marginTop: 8 },
  action: { marginTop: 24 },
});
