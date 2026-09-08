import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { ROLE_DASHBOARDS } from "../../context/AuthContext";
import { extractErrorMessage } from "../../api/client";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";
import "./LoginPage.css";

const FEATURES = [
  {
    icon: <ShieldIcon />,
    title: "Blockchain-Secured Audit Trail",
    body: "Every approved expense is recorded on a tamper-proof ledger.",
  },
  {
    icon: <LayersIcon />,
    title: "Role-Based Access",
    body: "Every account sees exactly what its role is meant to see.",
  },
  {
    icon: <ChartIcon />,
    title: "Live Project Visibility",
    body: "Budgets, status, and timelines, updated in real time.",
  },
];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

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
      {/* Left — brand panel over the real construction photo */}
      <div className="login-panel">
        <div className="login-panel-scrim" />
        <div className="login-panel-content">
          <div className="login-panel-top">
            <div className="login-brand-row">
              <img src="/images/logo.png" alt="" className="login-brand-mark" />
              <span className="login-brand-name">
                Brick <span className="login-brand-x">x</span> Brick
              </span>
            </div>
          </div>

          <div className="login-panel-copy">
            <p className="login-eyebrow">Construction Management</p>
            <h1 className="login-headline">
              Building Trust.
              <br />
              <span className="login-headline-accent">Securing Value.</span>
            </h1>
            <p className="login-panel-tagline">
              Construction management with blockchain-secured financial
              controls.
            </p>

            <ul className="login-features">
              {FEATURES.map((f) => (
                <li key={f.title} className="login-feature">
                  <span className="login-feature-icon">{f.icon}</span>
                  <span>
                    <span className="login-feature-title">{f.title}</span>
                    <span className="login-feature-body">{f.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="login-panel-footer">
            <div className="login-security-note">
              <ShieldIcon small />
              <span>Your data is protected with enterprise-grade security.</span>
            </div>
            <p className="login-copyright">© 2026 Brick x Brick. All rights reserved.</p>
          </div>
        </div>
      </div>

      {/* Right — the actual sign-in form */}
      <div className="login-form-side">
        <div className="login-card">
          <div className="login-card-mark">
            <img src="/images/logo.png" alt="Brick x Brick" className="login-card-logo" />
          </div>
          <h2 className="login-title">Welcome back</h2>
          <p className="login-subtitle">Sign in to your dashboard</p>

          <form onSubmit={handleSubmit} noValidate className="login-form">
            <div className="login-field-icon-wrap">
              <Field
                label="Email Address"
                type="email"
                required
                autoComplete="email"
                placeholder="you@company.com"
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

            <div className="login-form-row">
              <span />
              <a href="#" className="login-forgot" onClick={(e) => e.preventDefault()}>
                Forgot Password?
              </a>
            </div>

            <Button type="submit" disabled={submitting} className="login-submit">
              {submitting ? "Logging in…" : (
                <>
                  Log In <ArrowIcon />
                </>
              )}
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

function ArrowIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShieldIcon({ small }) {
  const size = small ? 16 : 20;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5l-8-3Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m12 2 9 5-9 5-9-5 9-5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="m3 12 9 5 9-5M3 17l9 5 9-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20V10M11 20V4M18 20v-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
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
