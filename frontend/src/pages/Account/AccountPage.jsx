import { useState } from "react";
import { changePassword, updateUsername } from "../../api/accountApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { useLocale } from "../../i18n/LocaleProvider";

const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/;

// /account — every signed-in user can set a username and change their password.
// Others see the username as "username.role".
export function AccountPage() {
  const { user, markUsernameChanged } = useAuth();
  const { t } = useLocale();

  const [username, setUsername] = useState(user?.username || "");
  const [usernameMsg, setUsernameMsg] = useState(null);
  const [savingUsername, setSavingUsername] = useState(false);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordMsg, setPasswordMsg] = useState(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const roleSlug = String(user?.role || "").toLowerCase().replace(/\s+/g, "-");
  const label = `${username.trim() || "username"}.${roleSlug}`;

  async function saveUsername(e) {
    e.preventDefault();
    const value = username.trim();
    if (!USERNAME_RE.test(value)) {
      setUsernameMsg({ type: "error", text: t("settings.username_invalid") });
      return;
    }
    setSavingUsername(true);
    setUsernameMsg(null);
    try {
      const saved = await updateUsername(value);
      markUsernameChanged(saved.username, saved.name);
      setUsernameMsg({ type: "success", text: t("settings.saved") });
    } catch (err) {
      setUsernameMsg({ type: "error", text: extractErrorMessage(err) });
    } finally {
      setSavingUsername(false);
    }
  }

  async function savePassword(e) {
    e.preventDefault();
    if (next.length < 8) return setPasswordMsg({ type: "error", text: t("settings.password_short") });
    if (next !== confirm) return setPasswordMsg({ type: "error", text: t("settings.password_mismatch") });
    setSavingPassword(true);
    setPasswordMsg(null);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setPasswordMsg({ type: "success", text: t("settings.password_changed") });
    } catch (err) {
      setPasswordMsg({ type: "error", text: extractErrorMessage(err) });
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)", maxWidth: 480 }}>
      <form onSubmit={saveUsername} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <h2>{t("settings.username")}</h2>
        <Field
          label={t("settings.username")}
          value={username}
          maxLength={30}
          autoComplete="username"
          onChange={(e) => setUsername(e.target.value)}
        />
        <p className="field-hint">{t("settings.username_hint", { label })}</p>
        {usernameMsg && <Banner tone={usernameMsg.type}>{usernameMsg.text}</Banner>}
        <Button type="submit" disabled={savingUsername}>{t("settings.save")}</Button>
      </form>

      <form onSubmit={savePassword} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <h2>{t("settings.change_password")}</h2>
        <Field label={t("settings.current_password")} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <Field label={t("settings.new_password")} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <Field label={t("settings.confirm_password")} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {passwordMsg && <Banner tone={passwordMsg.type}>{passwordMsg.text}</Banner>}
        <Button type="submit" disabled={savingPassword || !current || !next}>{t("settings.change_password")}</Button>
      </form>
    </div>
  );
}
