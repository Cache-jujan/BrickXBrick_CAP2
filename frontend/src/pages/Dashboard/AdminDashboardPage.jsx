import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getAdminOverview } from "../../api/adminApi";
import { extractErrorMessage } from "../../api/client";
import { AdminOverview } from "../../components/admin/AdminOverview";
import { Banner } from "../../components/ui/Banner";
import { useLocale } from "../../i18n/LocaleProvider";
import "./AdminDashboardPage.css";

// The System Administrator's dashboard: who can sign in, and whether the
// tamper-proof records need attention. Account actions stay on User accounts.
export function AdminDashboardPage() {
  const { t } = useLocale();
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getAdminOverview()
      .then((data) => { if (!cancelled) setOverview(data); })
      .catch((err) => { if (!cancelled) setError(extractErrorMessage(err, t("admin_overview.load_error"))); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once; a language change must not refetch
  }, []);

  return (
    <div className="admin-dash">
      <h1>{t("nav.dashboard")}</h1>
      <p className="admin-dash-subtitle">{t("admin_overview.subtitle")}</p>

      {error && <Banner tone="error" title={error} />}
      {!error && !overview && <p className="dashboard-loading">{t("common.loading")}</p>}
      {overview && <AdminOverview overview={overview} />}

      <div className="admin-dash-links">
        <Link className="admin-dash-link" to="/admin/users">{t("nav.user_accounts")} →</Link>
        <Link className="admin-dash-link" to="/blockchain/alerts">{t("nav.tamper_alerts")} →</Link>
      </div>
    </div>
  );
}
