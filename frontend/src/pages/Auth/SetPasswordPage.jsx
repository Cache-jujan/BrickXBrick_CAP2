import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../api/supabaseClient";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";
import { Card } from "../../components/ui/Card";
import { EyeIcon, EyeOffIcon } from "../../components/ui/icons";
import { PasswordChecklist } from "../../components/ui/PasswordChecklist";
import { passwordMeetsRules } from "../../utils/passwordRules";
import { LINK_TYPE_KEY } from "../../auth/authLinkRedirect";
import { useLocale } from "../../i18n/LocaleProvider";
import "./AuthPages.css";

/** Return the link type saved before Supabase clears the URL, or null if absent or storage is blocked. */
function readLinkType() {
  try {
    return sessionStorage.getItem(LINK_TYPE_KEY);
  } catch {
    return null;
  }
}

/** Remove the saved link type after password setup, tolerating blocked session storage. */
function clearLinkType() {
  try {
    sessionStorage.removeItem(LINK_TYPE_KEY);
  } catch {
    // nothing to clear
  }
}

// A password field with its own show/hide button (the Field component has none).
function PasswordField({ label, value, onChange, autoComplete }) {
  const { t } = useLocale();
  const [shown, setShown] = useState(false);
  return (
    <div className="auth-password">
      <Field label={label} required type={shown ? "text" : "password"} value={value}
        onChange={onChange} autoComplete={autoComplete} />
      <button
        type="button"
        className="auth-password-toggle"
        onClick={() => setShown((v) => !v)}
        aria-label={t(shown ? "auth.hide_field" : "auth.show_field", { field: label.toLowerCase() })}
        aria-pressed={shown}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

/** Render invite or recovery password setup after verifying the Supabase session, with invalid-link guidance. */
export function SetPasswordPage() {
  const navigate = useNavigate();
  const { t } = useLocale();
  const [ready, setReady] = useState(false);
  const [waited, setWaited] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [isInvite] = useState(() => readLinkType() === "invite");

  const linkBroken = window.location.hash.includes("error=");

  useEffect(() => {
    if (linkBroken) return;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setReady(true);
    });
    supabase.auth.getSession().then(({ data: s }) => { if (s.session) setReady(true); });
    const timer = setTimeout(() => setWaited(true), 3000);
    return () => { data.subscription.unsubscribe(); clearTimeout(timer); };
  }, [linkBroken]);

  /** Validate and save the password, then sign out, clear the link type, and return to sign in. */
  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!passwordMeetsRules(password)) return setError(t("pw.rules_not_met"));
    if (password !== confirm) return setError(t("errors.password_mismatch"));

    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      setBusy(false);
      return setError(err.message);
    }
    await supabase.auth.signOut(); // the app logs in through its own backend
    clearLinkType();
    navigate("/login", {
      replace: true,
      state: {
        successMessage: isInvite ? t("auth.account_ready") : t("auth.password_set"),
      },
    });
  }

  const showForm = ready && !linkBroken;
  const showBroken = linkBroken || (!ready && waited);

  return (
    <div className="auth-simple">
      <Card className="auth-simple-card">
        <h1>{isInvite ? t("auth.create_password") : t("auth.set_password")}</h1>

        {showBroken && (
          <>
            <Banner tone="error" title={t("auth.link_invalid_title")}>
              {t("auth.link_invalid_body")}
            </Banner>
            <Link to="/forgot-password" className="auth-simple-back">{t("auth.forgot_title")}</Link>
          </>
        )}

        {!showForm && !showBroken && <p className="auth-simple-sub">{t("auth.verifying")}</p>}

        {showForm && (
          <form onSubmit={handleSubmit} noValidate>
            <p className="auth-simple-sub">
              {isInvite ? t("auth.welcome_invite") : t("auth.choose_password")}
            </p>
            <PasswordField label={t("auth.new_password")} value={password}
              onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <PasswordChecklist password={password} />
            <PasswordField label={t("auth.confirm_password")} value={confirm}
              onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            {error && <Banner tone="error" title={error} />}
            <Button type="submit" disabled={busy} style={{ width: "100%" }}>
              {busy ? t("common.saving") : t("auth.save_password")}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}