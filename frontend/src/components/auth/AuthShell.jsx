import { useLocale } from "../../i18n/LocaleProvider";
import "./AuthShell.css";

/**
 * The frame shared by Sign in, Forgot password and Set password: the brand story on a
 * construction photo on the left, and the form in a card on the right. On a phone the
 * photo is dropped and only the brand name stays above the card.
 */
export function AuthShell({ children }) {
  const { t } = useLocale();
  return (
    <div className="auth-screen">
      <aside className="auth-story">
        <div className="auth-story-inner">
          <div className="auth-brand">
            <img src="/images/logo.png" alt="" className="auth-brand-logo" />
            <span className="auth-brand-name">
              Brick <span className="auth-brand-x">x</span> Brick
            </span>
          </div>

          <div className="auth-story-copy">
            <h1 className="auth-headline">
              {t("login.story_lead")} <span className="auth-headline-accent">{t("login.story_accent")}</span>
            </h1>
            <span className="auth-rule" aria-hidden="true" />
            <p className="auth-story-body">{t("login.story_body")}</p>

            <ul className="auth-features">
              <li>
                <span className="auth-feature-icon"><ShieldIcon /></span>
                <span>{t("login.feat_secure")}</span>
              </li>
              <li>
                <span className="auth-feature-icon"><BarsIcon /></span>
                <span>{t("login.feat_track")}</span>
              </li>
              <li>
                <span className="auth-feature-icon"><HandshakeIcon /></span>
                <span>{t("login.feat_business")}</span>
              </li>
            </ul>
          </div>

          <p className="auth-copyright">&copy; 2026 Brick x Brick</p>
        </div>
      </aside>

      <main className="auth-side">
        <div className="auth-mobile-brand">
          <img src="/images/logo.png" alt="" className="auth-brand-logo" />
          <span className="auth-mobile-brand-name">
            Brick <span className="auth-brand-x">x</span> Brick
          </span>
        </div>
        <div className="auth-card">{children}</div>
      </main>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 4.5 6v5.5c0 4.4 3 8.1 7.5 9.5 4.5-1.4 7.5-5.1 7.5-9.5V6L12 3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m8.8 12.2 2.4 2.4 4.2-4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BarsIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="12" width="4" height="8" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="10" y="8" width="4" height="12" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="16" y="4" width="4" height="16" rx="1" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function HandshakeIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m3 11 4-4 4 1.5L14 7l4 3 3 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m3 11 5 6a2 2 0 0 0 3 .2l1-1m0 0 1.5 1.3a2 2 0 0 0 2.8-.2l2.2-2.6M12 16.2l-2-2m1-3 2.5 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
