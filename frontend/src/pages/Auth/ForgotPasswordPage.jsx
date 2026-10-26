import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../api/supabaseClient";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";
import { Card } from "../../components/ui/Card";
import { useLocale } from "../../i18n/LocaleProvider";
import "./AuthPages.css";

const GMAIL_RE = /^[a-z0-9.]{6,30}@gmail\.com$/;

export function ForgotPasswordPage() {
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const clean = email.trim().toLowerCase();
    if (!GMAIL_RE.test(clean)) {
      setError(t("errors.invalid_gmail"));
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(clean, {
      redirectTo: `${window.location.origin}/set-password`,
    });
    setBusy(false);
    if (err?.status === 429) {
      setError(t("errors.too_many_requests"));
      return;
    }
    setSent(true); // same message whether or not the email exists
  }

  return (
    <div className="auth-simple">
      <Card className="auth-simple-card">
        <h1>{t("auth.forgot_title")}</h1>
        <p className="auth-simple-sub">{t("auth.forgot_sub")}</p>

        {sent ? (
          <Banner tone="info" title={t("auth.check_gmail_title")}>
            {t("auth.check_gmail_body")}
          </Banner>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <Field label={t("auth.gmail_label")} required type="email" placeholder="you@gmail.com"
              value={email} onChange={(e) => setEmail(e.target.value)} />
            {error && <Banner tone="error" title={error} />}
            <Button type="submit" disabled={busy} style={{ width: "100%" }}>
              {busy ? t("common.sending") : t("auth.send_reset")}
            </Button>
          </form>
        )}
        <Link to="/login" className="auth-simple-back">{t("auth.back_to_sign_in")}</Link>
      </Card>
    </div>
  );
}