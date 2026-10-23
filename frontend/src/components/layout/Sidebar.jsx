import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { listTamperAlerts } from "../../api/blockchainApi";
import { GridIcon, FolderIcon, UsersIcon, ChevronIcon } from "./icons";
import { useLocale } from "../../i18n/LocaleProvider";

function ReceiptIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

function TicketIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16v14H4z" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );
}
import "./Sidebar.css";

// Inline for now — swap for a real icon from ./icons if one already fits
// (warning triangle / shield style) rather than keeping this duplicate.
function AlertTriangleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

// alerts: "live" reads the badge count from GET /api/blockchain/alerts (real
// backend data — see FRONTEND_IMPLEMENTATION_TRACKER.md). Omit the key
// entirely for nav items that don't need a badge.
const NAV_BY_ROLE = {
  "General Manager": [
    { to: "/dashboard/gm", label: "nav.dashboard", icon: GridIcon },
    { to: "/projects", label: "nav.projects", icon: FolderIcon },
    { to: "/expenses", label: "nav.expenses", icon: ReceiptIcon },
    { to: "/reports", label: "nav.reports", icon: ChartIcon },
    { to: "/blockchain/alerts", label: "nav.tamper_alerts", icon: AlertTriangleIcon, alerts: "live" },
  ],
  "Project Manager": [
    { to: "/dashboard/pm", label: "nav.dashboard", icon: GridIcon },
    { to: "/tickets/queue", label: "nav.tickets", icon: TicketIcon },
    { to: "/tasks/progress-review", label: "nav.progress_review", icon: TicketIcon },
    { to: "/projects", label: "nav.projects", icon: FolderIcon },
    { to: "/expenses", label: "nav.expenses", icon: ReceiptIcon },
  ],
  "Site Manager": [
    { to: "/dashboard/sm", label: "nav.dashboard", icon: GridIcon },
    { to: "/tickets/new", label: "nav.create_ticket", icon: TicketIcon },
  ],
  Purchaser: [
  {
    to: "/dashboard/purchaser",
    label: "nav.dashboard",
    icon: GridIcon,
  },
  {
    to: "/expenses",
    label: "nav.my_expenses",
    icon: ReceiptIcon,
  },
],

  "System Administrator": [
    { to: "/dashboard/admin", label: "nav.dashboard", icon: GridIcon },
    { to: "/admin/users", label: "nav.user_accounts", icon: UsersIcon },
    { to: "/blockchain/alerts", label: "nav.tamper_alerts", icon: AlertTriangleIcon, alerts: "live" },
  ],
};

export function Sidebar({ mobileOpen = false, onNavigate }) {
  const { t } = useLocale();
  const { user } = useAuth();
  const links = NAV_BY_ROLE[user?.role] || [];
  const [collapsedPref, setCollapsed] = useState(false);
  // The mobile drawer is always shown expanded.
  const collapsed = collapsedPref && !mobileOpen;
  const [alertCount, setAlertCount] = useState(null);

  const needsAlertCount = links.some((l) => l.alerts === "live");

  // FUNCTION F12 — Blockchain Tamper Detection sidebar badge
  // STATUS: IMPLEMENTED (frontend) — reads the existing, already-working
  // GET /api/blockchain/alerts endpoint (open alerts only, per its own
  // WHERE resolvedAt IS NULL filter), so the count is always accurate as
  // of the last fetch.
  // TODO: this only refetches on mount/route-role change. If you want it
  // to update the instant an alert is resolved elsewhere in the app
  // without a full nav remount, lift this into shared state instead.
  // NOTE: only rendered for General Manager / System Administrator, since
  // that's what the backend's requireRole on /alerts already allows.
  useEffect(() => {
    if (!needsAlertCount) return;
    let cancelled = false;
    listTamperAlerts()
      .then((data) => {
        if (!cancelled) setAlertCount(data.length);
      })
      .catch(() => {
        if (!cancelled) setAlertCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [needsAlertCount]);

  return (
    <aside className={"sidebar" + (collapsed ? " sidebar-collapsed" : "") + (mobileOpen ? " sidebar-open" : "")}>
      <div className="sidebar-brand">
        <img src="/images/logo.png" alt="" className="sidebar-logo" />
        {!collapsed && (
          <span className="sidebar-brand-name">
            Brick <span className="sidebar-brand-x">x</span> Brick
          </span>
        )}
      </div>

      <nav className="sidebar-nav">
        {links.map((link) => {
          const Icon = link.icon;
          const showBadge = link.alerts === "live" && alertCount != null && alertCount > 0;
          return (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to.startsWith("/dashboard")}
              className={({ isActive }) => "sidebar-link" + (isActive ? " sidebar-link-active" : "")}
              title={collapsed ? t(link.label) : undefined}
              onClick={onNavigate}
            >
              <span className="sidebar-link-icon">
                <Icon />
              </span>
              {!collapsed && <span className="sidebar-link-label">{t(link.label)}</span>}
              {showBadge && (
                <span className="sidebar-link-badge" aria-label={`${alertCount} open ${t("nav.tamper_alerts")}`}>
                  {alertCount > 9 ? "9+" : alertCount}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <button
        type="button"
        className="sidebar-collapse-btn"
        onClick={() => setCollapsed((v) => !v)}
        aria-label={t(collapsed ? "nav.expand_sidebar" : "nav.collapse_sidebar")}
      >
        <ChevronIcon open={!collapsed} />
        {!collapsed && <span>{t("nav.collapse")}</span>}
      </button>

      <div className="sidebar-footer">
        {!collapsed && <p className="sidebar-footer-label">{t("nav.signed_in_as")}</p>}
        <p className="sidebar-footer-role">{collapsed ? user?.role?.[0] : user?.role}</p>
      </div>
    </aside>
  );
}
