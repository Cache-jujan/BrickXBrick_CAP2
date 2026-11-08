import { Link } from "react-router-dom";
import { Card } from "../ui/Card";
import { AlertCircleIcon, ClockIcon } from "../ui/icons";
import { AccountIcon, ArrowRightIcon } from "../legal/LegalIcons";
import { BellIcon, UsersIcon } from "../layout/icons";
import { PESO_EXACT } from "../../utils/plainLanguage";
import { useLocale } from "../../i18n/LocaleProvider";
import "./AdminOverview.css";

const ROLE_ORDER = ["General Manager", "Project Manager", "Site Manager", "Purchaser", "System Administrator"];
const SHOWN_ALERTS = 4;

// One summary tile. With `to`, the whole tile is a link and shows a chevron.
function Tile({ to, tone, icon, label, value, sub }) {
  const body = (
    <>
      <span className="ao-icon" aria-hidden="true">{icon}</span>
      <span className="ao-tile-text">
        <span className="ao-label">{label}</span>
        <strong className="ao-value">{value}</strong>
        <span className="ao-sub">{sub}</span>
      </span>
      {to && <span className="ao-chevron" aria-hidden="true"><ArrowRightIcon size={14} /></span>}
    </>
  );
  const cls = `ao-card ${tone ? `ao-${tone}` : ""}`;
  return to ? (
    <Link to={to} className={`${cls} ao-tile-link`}>{body}</Link>
  ) : (
    <Card className={cls}>{body}</Card>
  );
}

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
  const maxRole = Math.max(1, ...roles.map((r) => o.byRole[r]));

  return (
    <section className="ao" aria-label={t("admin_overview.title")}>
      <div className="ao-grid">
        <Tile
          to="/admin/users"
          icon={<UsersIcon />}
          label={t("admin_overview.active")}
          value={o.active}
          sub={t("admin_overview.inactive_sub", { count: o.inactive })}
        />
        <Tile
          to="/admin/users"
          tone={o.locked > 0 ? "warn" : ""}
          icon={<AccountIcon size={19} />}
          label={t("admin_overview.locked")}
          value={o.locked}
          sub={o.locked > 0 ? t("admin_overview.locked_sub") : t("admin_overview.none_locked")}
        />
        <Tile
          to="/blockchain/alerts"
          tone={o.openTamperAlerts > 0 ? "danger" : ""}
          icon={<BellIcon />}
          label={t("admin_overview.alerts")}
          value={o.openTamperAlerts}
          sub={t("admin_overview.alerts_sub")}
        />
        <Tile
          tone={o.overdueBlockchain > 0 ? "warn" : ""}
          icon={<ClockIcon size={19} />}
          label={t("admin_overview.overdue")}
          value={o.overdueBlockchain}
          sub={t("admin_overview.overdue_sub", { count: o.pendingBlockchain })}
        />
      </div>

      <div className="ao-split">
        <Card className={`ao-panel ${alerts.length > 0 ? "ao-panel-alert" : ""}`}>
          <div className="ao-panel-head">
            <span className="ao-icon ao-icon-sm" aria-hidden="true"><AlertCircleIcon size={18} /></span>
            <h2 className="ao-panel-title">{t("admin_overview.attention_title")}</h2>
            {o.openTamperAlerts > 0 && (
              <Link className="ao-head-link" to="/blockchain/alerts">
                {t("admin_overview.view_all_alerts", { count: o.openTamperAlerts })} <ArrowRightIcon size={14} />
              </Link>
            )}
          </div>
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
                              .join(" \u00b7 ")}
                          </span>
                        </span>
                        <span className="ao-row-amount">{PESO_EXACT.format(a.amount)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>

        <Card className="ao-panel">
          <div className="ao-panel-head">
            <h2 className="ao-panel-title">{t("admin_overview.by_role")}</h2>
          </div>
          <ul className="ao-list">
            {roles.map((r) => (
              <li key={r} className="ao-role">
                <span className="ao-role-line">
                  <span>{r}</span>
                  <strong>{o.byRole[r]}</strong>
                </span>
                <span className="ao-bar" aria-hidden="true">
                  <span className="ao-bar-fill" style={{ width: `${(o.byRole[r] / maxRole) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
          <Link className="ao-foot-link" to="/admin/users">
            {t("admin_overview.manage_accounts")} <ArrowRightIcon size={14} />
          </Link>
        </Card>
      </div>
    </section>
  );
}
