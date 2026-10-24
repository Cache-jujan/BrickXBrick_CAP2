import { useAuth } from "../context/AuthContext";
import { useLocale } from "../i18n/LocaleProvider";
import "./MobileOnlyPage.css";

// Full-screen wall for roles that have no web app at all (Site Manager,
// Purchaser). Rendered at the app entry instead of the dashboard shell, so
// there's no sidebar and no reachable web page — just a prompt to use the
// mobile app, and a way to sign out.
export function MobileOnlyPage() {
  const { user, logout } = useAuth();
  const { t } = useLocale();
  const first = user?.name ? user.name.split(" ")[0] : "";
  const greeting = first ? t("auth.mobile_only_hi_named", { name: first }) : t("auth.mobile_only_hi");

  return (
    <div className="mobile-wall">
      <div className="mobile-wall-card">
        <img src="/images/logo.png" alt="" className="mobile-wall-logo" />
        <h1 className="mobile-wall-title">{t("auth.mobile_only_title")}</h1>
        <p className="mobile-wall-text">
          {greeting} {t("auth.mobile_only_body", { role: user?.role ?? "" })}
        </p>
        <button type="button" className="btn btn-secondary mobile-wall-logout" onClick={logout}>
          {t("account.logout")}
        </button>
      </div>
    </div>
  );
}