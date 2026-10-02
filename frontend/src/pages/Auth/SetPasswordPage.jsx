import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../api/supabaseClient";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";
import { Card } from "../../components/ui/Card";
import "./AuthPages.css";

const MIN_LENGTH = 8;

export function SetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [waited, setWaited] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < MIN_LENGTH) return setError(`Password must be at least ${MIN_LENGTH} characters.`);
    if (password !== confirm) return setError("Passwords do not match.");

    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      setBusy(false);
      return setError(err.message);
    }
    await supabase.auth.signOut(); // the app logs in through its own backend
    navigate("/login", { replace: true, state: { successMessage: "Password set. You can now sign in." } });
  }

  const showForm = ready && !linkBroken;
  const showBroken = linkBroken || (!ready && waited);

  return (
    <div className="auth-simple">
      <Card className="auth-simple-card">
        <h1>Set your password</h1>

        {showBroken && (
          <>
            <Banner tone="error" title="This link is invalid or has expired">
              Ask your System Administrator to resend your invitation, or use Forgot password.
            </Banner>
            <Link to="/forgot-password" className="auth-simple-back">Forgot password</Link>
          </>
        )}

        {!showForm && !showBroken && <p className="auth-simple-sub">Verifying your link…</p>}

        {showForm && (
          <form onSubmit={handleSubmit} noValidate>
            <p className="auth-simple-sub">Choose a password you'll use to sign in to Brick x Brick.</p>
            <Field label="New password" required type="password" value={password}
              onChange={(e) => setPassword(e.target.value)} />
            <Field label="Confirm password" required type="password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)} />
            {error && <Banner tone="error" title={error} />}
            <Button type="submit" disabled={busy} style={{ width: "100%" }}>
              {busy ? "Saving…" : "Save password"}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}