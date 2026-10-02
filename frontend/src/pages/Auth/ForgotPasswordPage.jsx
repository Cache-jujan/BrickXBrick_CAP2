import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../api/supabaseClient";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";
import { Card } from "../../components/ui/Card";
import "./AuthPages.css";

const GMAIL_RE = /^[a-z0-9.]{6,30}@gmail\.com$/;

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const clean = email.trim().toLowerCase();
    if (!GMAIL_RE.test(clean)) {
      setError("Enter a valid Gmail address (name@gmail.com).");
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(clean, {
      redirectTo: `${window.location.origin}/set-password`,
    });
    setBusy(false);
    if (err?.status === 429) {
      setError("Too many requests. Please wait a few minutes and try again.");
      return;
    }
    setSent(true); // same message whether or not the email exists
  }

  return (
    <div className="auth-simple">
      <Card className="auth-simple-card">
        <h1>Forgot password</h1>
        <p className="auth-simple-sub">Enter your Gmail and we'll send you a link to set a new password.</p>

        {sent ? (
          <Banner tone="info" title="Check your Gmail">
            If that Gmail is registered, a reset link has been sent. Check your spam folder too.
          </Banner>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <Field label="Gmail address" required type="email" placeholder="you@gmail.com"
              value={email} onChange={(e) => setEmail(e.target.value)} />
            {error && <Banner tone="error" title={error} />}
            <Button type="submit" disabled={busy} style={{ width: "100%" }}>
              {busy ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}
        <Link to="/login" className="auth-simple-back">Back to sign in</Link>
      </Card>
    </div>
  );
}