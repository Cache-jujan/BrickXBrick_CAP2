import { Link } from "react-router-dom";
import { Card } from "../ui/Card";
import { PESO_EXACT } from "../../utils/plainLanguage";
import { useLocale } from "../../i18n/LocaleProvider";
import "./AdminOverview.css";

const ROLE_ORDER = ["General Manager", "Project Manager", "Site Manager", "Purchaser", "System Administrator"];
const SHOWN_ALERTS = 4;

// What the System Administrator should see first: who can sign in, who is
// locked out, and whether the tamper-proof records need attention. Below the
// numbers, the open alerts themselves and the accounts by role.
// `alerts` is the list of open tamper alerts (may be empty or missing).
export function AdminOverview({ overview, alerts = [] }) {
  const { t, formatDate } = useLocale();
  const o = overview;
  const shown = alerts.slice(0, SHOWN_ALERTS);
  const nothingToDo = alerts.length === 0 && o.locked === 0 && o.openTamperAlerts === 0 && o.overdueBlockchain === 0;
  const roles = ROLE_ORDER.filter((r) => o.byRole?.[r]);

  return (
    <section className="ao" aria-label={t("admin_overview.title")}>
      <div className="ao-grid">
        <Card className="ao-card">
          <span className="ao-label">{t("admin_overview.active")}</span>
          <strong className="ao-value">{o.active}</strong>
          <span className="ao-sub">{t("admin_overview.inactive_sub", { count: o.inactive })}</span>
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

      <div className="ao-split">
        <Card className="ao-panel">
          <h2 className="ao-panel-title">{t("admin_overview.attention_title")}</h2>
          {nothingToDo ? (
            <p className="ao-clear">{t("admin_overview.attention_none")}</p>
          ) : (
            <>
              {o.locked > 0 && (
                <Link className="ao-line" to="/admin/users">
                  {t("admin_overview.locked_line", { count: o.locked })}
                </Link>
              )}
              {shown.length > 0 && (
                <ul className="ao-list">
                  {shown.map((a) => (
                    <li key={a.alertid}>
                      <Link className="ao-row" to="/blockchain/alerts">
                        <span className="ao-row-main">
                          <strong>{a.vendorname}</strong>
                          <span className="ao-row-sub">
                            {[a.projectname, t("admin_overview.found_on", { date: formatDate(a.detectedat, { dateStyle: "medium" }) })]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <span className="ao-row-amount">{PESO_EXACT.format(a.amount)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {o.openTamperAlerts > 0 && (
                <Link className="ao-foot-link" to="/blockchain/alerts">
                  {t("admin_overview.view_all_alerts", { count: o.openTamperAlerts })}
                </Link>
              )}
            </>
          )}
        </Card>

        <Card className="ao-panel">
          <h2 className="ao-panel-title">{t("admin_overview.by_role")}</h2>
          <ul className="ao-list ao-roles-list">
            {roles.map((r) => (
              <li key={r} className="ao-role">
                <span>{r}</span>
                <strong>{o.byRole[r]}</strong>
              </li>
            ))}
          </ul>
          <Link className="ao-foot-link" to="/admin/users">
            {t("admin_overview.manage_accounts")}
          </Link>
        </Card>
      </div>
    </section>
  );
}
