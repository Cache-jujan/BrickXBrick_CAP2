import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { ROLE_DASHBOARDS } from "../../context/AuthContext";
import { extractErrorMessage } from "../../api/client";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";
import "./LoginPage.css";

// Feature list mirrors what the backend actually supports today — RBAC
// (F1), project/expense tracking (F2/F6), and the F12 blockchain audit
// trail. Do not add claims for features that aren't implemented.
// FUNCTION F1 — Login
// STATUS: IMPLEMENTED
// PURPOSE: authenticate against POST /api/auth/login (Supabase-backed) and
// redirect to the role's dashboard.
// NOTE: this system has no self-registration and no Google/OAuth login —
// accounts are created by a System Administrator only (see adminUsers.js).
// Do not add a "Continue with Google" or sign-up affordance here.
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const successMessage = location.state?.successMessage;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await login(email, password);
      const destination = result.redirectPath || ROLE_DASHBOARDS[result.user.role] || "/";
      navigate(destination, { replace: true });
    } catch (err) {
      // The backend intentionally returns the same generic message whether
      // the email or the password was wrong — surface it as-is. A locked
      // account (423) and a deactivated account (403) get their own
      // explicit messages from the server, which we also just relay.
      setError(extractErrorMessage(err, "Invalid email or password."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      {/* Left — brand panel over the construction photo */}
      <div className="login-panel">
        <div className="login-panel-scrim" />
        <div className="login-panel-content">
          <div className="login-brand-row">
            <img src="/images/logo.png" alt="" className="login-brand-logo" />
            <span className="login-brand-name">
              Brick <span className="login-brand-x">x</span> Brick
            </span>
          </div>

          <div className="login-panel-copy">
            <h1 className="login-headline">Construction projects, purchases and expenses in one record.</h1>
            <p className="login-panel-tagline">
              For General Managers, Project Managers, Site Managers and Purchasers.
              Approved expenses are protected against later changes.
            </p>
          </div>

          <p className="login-copyright">&copy; 2026 Brick x Brick</p>
        </div>
      </div>

      {/* Right — the sign-in form */}
      <div className="login-form-side">
        <div className="login-card">
          <h2 className="login-title">Sign in</h2>
          <p className="login-subtitle">Use the account your System Administrator created for you.</p>

          <form onSubmit={handleSubmit} noValidate className="login-form">
            {successMessage && <Banner tone="info" title={successMessage} />}

            <div className="login-field-icon-wrap">
              <Field
                label="Email Address"
                type="email"
                required
                autoComplete="email"
                placeholder="you@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="login-field-icon"
              />
              <span className="login-field-prefix login-field-prefix-email">
                <MailIcon />
              </span>
            </div>

            <div className="login-field-icon-wrap login-password-field">
              <Field
                label="Password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="login-field-icon"
              />
              <span className="login-field-prefix">
                <LockIcon />
              </span>
              <button
                type="button"
                className="login-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>

            <p className="login-forgot">
              <Link to="/forgot-password">Forgot password?</Link>
            </p>

            <Button type="submit" disabled={submitting} className="login-submit">
              {submitting ? "Signing in…" : "Sign in"}
            </Button>

            {error && <Banner tone="error" title={error} />}
          </form>
        </div>

      </div>
    </div>
  );
}

/* --- Icons — small inline SVGs, no icon-library dependency --- */

function MailIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="m3 6 9 6 9-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon({ open }) {
  if (open) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M9.5 5.2A10.9 10.9 0 0 1 12 5c7 0 11 7 11 7a17.7 17.7 0 0 1-3.5 4.3M6.2 6.6C3.5 8.3 1 12 1 12a17.5 17.5 0 0 0 5.2 5.6c1.6 1 3.5 1.7 5.8 1.7 1 0 2-.1 2.9-.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
