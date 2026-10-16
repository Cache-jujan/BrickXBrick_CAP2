import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../api/supabaseClient";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";
import { Card } from "../../components/ui/Card";
import { EyeIcon, EyeOffIcon } from "../../components/ui/icons";
import { LINK_TYPE_KEY } from "../../auth/authLinkRedirect";
import "./AuthPages.css";

const MIN_LENGTH = 8;

// "invite" when this page was opened from a new-account email (saved by
// auth/authLinkRedirect.js before Supabase clears the link from the URL).
function readLinkType() {
  try {
    return sessionStorage.getItem(LINK_TYPE_KEY);
  } catch {
    return null;
  }
}

function clearLinkType() {
  try {
    sessionStorage.removeItem(LINK_TYPE_KEY);
  } catch {
    // nothing to clear
  }
}

// A password field with its own show/hide button (the Field component has none).
function PasswordField({ label, value, onChange, autoComplete }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="auth-password">
      <Field label={label} required type={shown ? "text" : "password"} value={value}
        onChange={onChange} autoComplete={autoComplete} />
      <button
        type="button"
        className="auth-password-toggle"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        aria-pressed={shown}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

export function SetPasswordPage() {
  const navigate = useNavigate();
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
    clearLinkType();
    navigate("/login", {
      replace: true,
      state: {
        successMessage: isInvite
          ? "Your account is ready. Sign in with your Gmail and new password."
          : "Password set. You can now sign in.",
      },
    });
  }

  const showForm = ready && !linkBroken;
  const showBroken = linkBroken || (!ready && waited);

  return (
    <div className="auth-simple">
      <Card className="auth-simple-card">
        <h1>{isInvite ? "Create your password" : "Set your password"}</h1>

        {showBroken && (
          <>
            <Banner tone="error" title="This link is invalid or has expired">
              Email links work once and expire after a while. Ask your System Administrator to send a new
              password email, or use Forgot password.
            </Banner>
            <Link to="/forgot-password" className="auth-simple-back">Forgot password</Link>
          </>
        )}

        {!showForm && !showBroken && <p className="auth-simple-sub">Verifying your link…</p>}

        {showForm && (
          <form onSubmit={handleSubmit} noValidate>
            <p className="auth-simple-sub">
              {isInvite
                ? "Welcome to Brick x Brick. Your account was created by your System Administrator. Choose the password you'll use to sign in."
                : "Choose a password you'll use to sign in to Brick x Brick."}
            </p>
            <PasswordField label="New password" value={password}
              onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <PasswordField label="Confirm password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
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