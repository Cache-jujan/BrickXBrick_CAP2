import { useRef, useState } from "react";
import { changePassword, removeAvatar, updateUsername, uploadAvatar } from "../../api/accountApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Avatar } from "../../components/ui/Avatar";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { PasswordField } from "../../components/ui/PasswordField";
import { PasswordChecklist } from "../../components/ui/PasswordChecklist";
import { ShieldCheckIcon } from "../../components/ui/icons";
import { passwordMeetsRules } from "../../utils/passwordRules";
import { useLocale } from "../../i18n/LocaleProvider";
import "./AccountPage.css";

const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/;
const AVATAR_TYPES = ["image/jpeg", "image/png"];
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const TIP_KEYS = ["account.tip_1", "account.tip_2", "account.tip_3", "account.tip_4"];

// /account — every signed-in user can set a username and change their password.
// Others see the username as "username.role".
export function AccountPage() {
  const { user, markUsernameChanged, markAvatarChanged } = useAuth();
  const { t } = useLocale();

  const [username, setUsername] = useState(user?.username || "");
  const [usernameMsg, setUsernameMsg] = useState(null);
  const [savingUsername, setSavingUsername] = useState(false);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordMsg, setPasswordMsg] = useState(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const fileInput = useRef(null);
  const [avatarMsg, setAvatarMsg] = useState(null);
  const [savingAvatar, setSavingAvatar] = useState(false);

  const roleSlug = String(user?.role || "").toLowerCase().replace(/\s+/g, "-");
  const label = `${username.trim() || "username"}.${roleSlug}`;
  const initial = (user?.name || user?.username || "?").trim()[0]?.toUpperCase() || "?";
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = !!current && passwordMeetsRules(next) && next === confirm && !savingPassword;

  async function pickAvatar(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so choosing the same file again still fires
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type)) return setAvatarMsg({ type: "error", text: t("account.photo_type") });
    if (file.size > AVATAR_MAX_BYTES) return setAvatarMsg({ type: "error", text: t("account.photo_size") });
    setSavingAvatar(true);
    setAvatarMsg(null);
    try {
      markAvatarChanged(await uploadAvatar(file));
      setAvatarMsg({ type: "success", text: t("account.photo_saved") });
    } catch (err) {
      setAvatarMsg({ type: "error", text: extractErrorMessage(err) });
    } finally {
      setSavingAvatar(false);
    }
  }

  async function dropAvatar() {
    setSavingAvatar(true);
    setAvatarMsg(null);
    try {
      await removeAvatar();
      markAvatarChanged(null);
      setAvatarMsg({ type: "success", text: t("account.photo_removed") });
    } catch (err) {
      setAvatarMsg({ type: "error", text: extractErrorMessage(err) });
    } finally {
      setSavingAvatar(false);
    }
  }

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
    if (!passwordMeetsRules(next)) return setPasswordMsg({ type: "error", text: t("pw.rules_not_met") });
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
    <div className="account">
      <header className="account-head">
        <h1>{t("account.title")}</h1>
        <p>{t("account.subtitle")}</p>
      </header>

      <div className="account-grid">
        <div className="account-main">
          <Card className="account-card">
            <h2>{t("account.profile_info")}</h2>
            <div className="account-who">
              <Avatar className="account-avatar" url={user?.avatarUrl} initial={initial} />
              <div className="account-who-text">
                <p className="account-who-name">{user?.name}</p>
                <p className="account-who-role">{user?.role}</p>
                <div className="account-photo-actions">
                  <input ref={fileInput} type="file" accept="image/jpeg,image/png" hidden onChange={pickAvatar} />
                  <Button type="button" variant="secondary" disabled={savingAvatar} onClick={() => fileInput.current?.click()}>
                    {t(user?.avatarUrl ? "account.photo_change" : "account.photo_add")}
                  </Button>
                  {user?.avatarUrl && (
                    <Button type="button" variant="ghost" disabled={savingAvatar} onClick={dropAvatar}>
                      {t("account.photo_remove")}
                    </Button>
                  )}
                </div>
              </div>
            </div>
            {avatarMsg && <Banner tone={avatarMsg.type}>{avatarMsg.text}</Banner>}
            <form onSubmit={saveUsername}>
              <Field label={t("settings.username")} value={username} maxLength={30}
                autoComplete="username" onChange={(e) => setUsername(e.target.value)} />
              <p className="field-hint">{t("settings.username_hint", { label })}</p>
              <Field label={t("account.email")} value={user?.email || ""} disabled readOnly />
              {usernameMsg && <Banner tone={usernameMsg.type}>{usernameMsg.text}</Banner>}
              <Button type="submit" disabled={savingUsername}>{t("settings.save")}</Button>
            </form>
          </Card>

          <Card className="account-card">
            <h2>{t("settings.change_password")}</h2>
            <p className="account-sub">{t("account.password_sub")}</p>
            <form onSubmit={savePassword}>
              <PasswordField label={t("settings.current_password")} autoComplete="current-password"
                value={current} onChange={(e) => setCurrent(e.target.value)} />
              <PasswordField label={t("settings.new_password")} autoComplete="new-password"
                value={next} onChange={(e) => setNext(e.target.value)} />
              <PasswordChecklist password={next} />
              <PasswordField label={t("settings.confirm_password")} autoComplete="new-password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
                error={mismatch ? t("pw.must_match") : undefined} />
              {passwordMsg && <Banner tone={passwordMsg.type}>{passwordMsg.text}</Banner>}
              <Button type="submit" disabled={!canSubmit}>{t("pw.update")}</Button>
            </form>
          </Card>
        </div>

        <Card className="account-card account-tips">
          <h2><ShieldCheckIcon size={18} /> {t("account.tips_title")}</h2>
          <ul>
            {TIP_KEYS.map((key) => <li key={key}>{t(key)}</li>)}
          </ul>
        </Card>
      </div>
    </div>
  );
}
