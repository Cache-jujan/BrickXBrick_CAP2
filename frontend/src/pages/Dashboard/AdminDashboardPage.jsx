import { useEffect, useState } from "react";
import { getAdminOverview } from "../../api/adminApi";
import { listTamperAlerts } from "../../api/blockchainApi";
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
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getAdminOverview()
      .then((data) => { if (!cancelled) setOverview(data); })
      .catch((err) => { if (!cancelled) setError(extractErrorMessage(err, t("admin_overview.load_error"))); });
    // The alert list is a bonus: if it fails, the numbers above still show.
    listTamperAlerts("open")
      .then((rows) => { if (!cancelled) setAlerts(Array.isArray(rows) ? rows : []); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once; a language change must not refetch
  }, []);

  return (
    <div className="admin-dash">
      <h1>{t("nav.dashboard")}</h1>
      <p className="admin-dash-subtitle">{t("admin_overview.subtitle")}</p>

      {error && <Banner tone="error" title={error} />}
      {!error && !overview && <p className="dashboard-loading">{t("common.loading")}</p>}
      {overview && <AdminOverview overview={overview} alerts={alerts} />}
    </div>
  );
}
