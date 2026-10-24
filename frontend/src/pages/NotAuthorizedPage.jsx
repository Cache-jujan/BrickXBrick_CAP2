import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ROLE_DASHBOARDS } from "../context/AuthContext";
import { useLocale } from "../i18n/LocaleProvider";
import "./NotAuthorizedPage.css";

export function NotAuthorizedPage() {
  const { user } = useAuth();
  const { t } = useLocale();
  const home = user ? ROLE_DASHBOARDS[user.role] || "/" : "/login";

  return (
    <div className="not-authorized">
      <div className="not-authorized-card">
        <p className="not-authorized-code">403</p>
        <h1>{t("auth.not_authorized_title")}</h1>
        <p className="not-authorized-body">{t("auth.not_authorized_body")}</p>
        <Link to={home} className="btn btn-primary">
          {user ? t("auth.back_to_dashboard") : t("auth.go_to_sign_in")}
        </Link>
      </div>
    </div>
  );
}
