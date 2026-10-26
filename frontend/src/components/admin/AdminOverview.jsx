import { Link } from "react-router-dom";
import { Card } from "../ui/Card";
import { useLocale } from "../../i18n/LocaleProvider";
import "./AdminOverview.css";

const ROLE_ORDER = ["General Manager", "Project Manager", "Site Manager", "Purchaser", "System Administrator"];

// Four numbers the System Administrator should see first: who can sign in,
// who is locked out, and whether the tamper-proof records need attention.
export function AdminOverview({ overview }) {
  const { t } = useLocale();
  const o = overview;
  return (
    <section className="ao" aria-label={t("admin_overview.title")}>
      <div className="ao-grid">
        <Card className="ao-card">
          <span className="ao-label">{t("admin_overview.active")}</span>
          <strong className="ao-value">{o.active}</strong>
          <span className="ao-sub">{t("admin_overview.inactive_sub", { count: o.inactive })}</span>
          <Link className="ao-sub ao-link" to="/admin/users">{t("admin_overview.accounts_sub")}</Link>
        </Card>
        <Card className={`ao-card ${o.locked > 0 ? "ao-warn" : ""}`}>
          <span className="ao-label">{t("admin_overview.locked")}</span>
          <strong className="ao-value">{o.locked}</strong>
          <span className="ao-sub">{o.locked > 0 ? t("admin_overview.locked_sub") : t("admin_overview.none_locked")}</span>
        </Card>
        <Card className={`ao-card ${o.openTamperAlerts > 0 ? "ao-danger" : ""}`}>
          <span className="ao-label">{t("admin_overview.alerts")}</span>
          <strong className="ao-value">{o.openTamperAlerts}</strong>
          <Link className="ao-sub ao-link" to="/blockchain/alerts">{t("admin_overview.alerts_sub")}</Link>
        </Card>
        <Card className={`ao-card ${o.overdueBlockchain > 0 ? "ao-warn" : ""}`}>
          <span className="ao-label">{t("admin_overview.overdue")}</span>
          <strong className="ao-value">{o.overdueBlockchain}</strong>
          <span className="ao-sub">{t("admin_overview.overdue_sub", { count: o.pendingBlockchain })}</span>
        </Card>
      </div>
      <p className="ao-roles">
        <span className="ao-roles-title">{t("admin_overview.by_role")}</span>
        {ROLE_ORDER.filter((r) => o.byRole?.[r]).map((r) => (
          <span key={r} className="ao-chip">{r} <strong>{o.byRole[r]}</strong></span>
        ))}
      </p>
    </section>
  );
}
