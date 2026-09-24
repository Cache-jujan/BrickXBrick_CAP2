import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { listTamperAlerts } from "../../api/blockchainApi";
import { GridIcon, FolderIcon, UsersIcon, ChevronIcon } from "./icons";

function ReceiptIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z" />
      <path d="M9 8h6M9 12h6" />
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
    { to: "/dashboard/gm", label: "Dashboard", icon: GridIcon },
    { to: "/projects", label: "Projects", icon: FolderIcon },
    { to: "/expenses", label: "Expenses", icon: ReceiptIcon },
    { to: "/blockchain/alerts", label: "Tamper Alerts", icon: AlertTriangleIcon, alerts: "live" },
  ],
  "Project Manager": [
    { to: "/dashboard/pm", label: "Dashboard", icon: GridIcon },
    { to: "/tickets/queue", label: "Ticket Queue", icon: TicketIcon },
    { to: "/projects", label: "Projects", icon: FolderIcon },
    { to: "/expenses", label: "Expenses", icon: ReceiptIcon },
  ],
  "Site Manager": [
    { to: "/dashboard/sm", label: "Dashboard", icon: GridIcon },
    { to: "/tickets/new", label: "Create Ticket", icon: TicketIcon },
  ],
  Purchaser: [{ to: "/dashboard/purchaser", label: "Dashboard", icon: GridIcon }],
  "System Administrator": [
    { to: "/dashboard/admin", label: "Dashboard", icon: GridIcon },
    { to: "/admin/users", label: "User Accounts", icon: UsersIcon },
    { to: "/blockchain/alerts", label: "Tamper Alerts", icon: AlertTriangleIcon, alerts: "live" },
  ],
};

export function Sidebar({ mobileOpen = false, onNavigate }) {
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
              title={collapsed ? link.label : undefined}
              onClick={onNavigate}
            >
              <span className="sidebar-link-icon">
                <Icon />
              </span>
              {!collapsed && <span className="sidebar-link-label">{link.label}</span>}
              {showBadge && (
                <span className="sidebar-link-badge" aria-label={`${alertCount} open tamper alerts`}>
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
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <ChevronIcon open={!collapsed} />
        {!collapsed && <span>Collapse</span>}
      </button>

      <div className="sidebar-footer">
        {!collapsed && <p className="sidebar-footer-label">Signed in as</p>}
        <p className="sidebar-footer-role">{collapsed ? user?.role?.[0] : user?.role}</p>
      </div>
    </aside>
  );
}
