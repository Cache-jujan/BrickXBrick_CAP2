import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { listTamperAlerts } from "../../api/blockchainApi";
import {
  GridIcon, FolderIcon, UsersIcon, ChevronIcon, InboxIcon, WalletIcon, ReceiptPlusIcon,
  BarChartIcon, ShieldAlertIcon, TicketIcon, PlusSquareIcon, ClipboardCheckIcon, GearIcon,
} from "./icons";
import { useLocale } from "../../i18n/LocaleProvider";

import "./Sidebar.css";

// Ways to submit an expense other than a single receipt for one request; listed under "Submit expense".
const SUBMIT_EXPENSE_CHILDREN = [
  { to: "/expenses/split", label: "nav.split_receipt" },
  { to: "/expenses/trip-cost", label: "nav.trip_cost" },
];

// alerts: "live" reads the badge count from GET /api/blockchain/alerts (real
// backend data — see FRONTEND_IMPLEMENTATION_TRACKER.md). Omit the key
// entirely for nav items that don't need a badge.
const NAV_BY_ROLE = {
  "General Manager": [
    { to: "/dashboard/gm", label: "nav.dashboard", icon: GridIcon },
    { to: "/projects", label: "nav.projects", icon: FolderIcon },
    { to: "/requests", label: "nav.open_requests", icon: InboxIcon },
    { to: "/expenses", label: "nav.expenses", icon: WalletIcon, end: true },
    { to: "/expenses/new", label: "nav.submit_expense", icon: ReceiptPlusIcon, end: true, children: SUBMIT_EXPENSE_CHILDREN },
    { to: "/reports", label: "nav.reports", icon: BarChartIcon },
    { to: "/blockchain/alerts", label: "nav.tamper_alerts", icon: ShieldAlertIcon, alerts: "live" },
  ],
  "Project Manager": [
    { to: "/dashboard/pm", label: "nav.dashboard", icon: GridIcon },
    { to: "/tickets/queue", label: "nav.tickets", icon: TicketIcon },
    { to: "/tasks/progress-review", label: "nav.progress_review", icon: ClipboardCheckIcon },
    { to: "/projects", label: "nav.projects", icon: FolderIcon },
    { to: "/requests", label: "nav.open_requests", icon: InboxIcon },
    { to: "/expenses", label: "nav.expenses", icon: WalletIcon, end: true },
    { to: "/expenses/new", label: "nav.submit_expense", icon: ReceiptPlusIcon, end: true, children: SUBMIT_EXPENSE_CHILDREN },
  ],
  "Site Manager": [
    { to: "/dashboard/sm", label: "nav.dashboard", icon: GridIcon },
    { to: "/tickets/new", label: "nav.create_ticket", icon: PlusSquareIcon },
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
    icon: WalletIcon,
  },
],

  "System Administrator": [
    { to: "/dashboard/admin", label: "nav.dashboard", icon: GridIcon },
    { to: "/admin/users", label: "nav.user_accounts", icon: UsersIcon },
    { to: "/blockchain/alerts", label: "nav.tamper_alerts", icon: ShieldAlertIcon, alerts: "live" },
  ],
};

const COLLAPSED_KEY = "bxb_sidebar_collapsed";
const HOVER_OPEN_MS = 120; // a short pause, so sweeping the mouse across the rail doesn't open it

function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

// A group (e.g. "Submit expense") is on the current page when the page is the group or one of its children.
const groupIsCurrent = (link, pathname) =>
  Boolean(link.children) && (pathname === link.to || link.children.some((c) => c.to === pathname));

export function Sidebar({ mobileOpen = false, onNavigate }) {
  const { t } = useLocale();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const links = NAV_BY_ROLE[user?.role] || [];
  // The person's choice (the Collapse button), remembered between visits.
  const [collapsedPref, setCollapsedPref] = useState(readCollapsed);
  // While the rail is collapsed, pointing at it (or tabbing into it) opens it over the page.
  const [peeking, setPeeking] = useState(false);
  const peekTimer = useRef(null);
  // The mobile drawer is always shown expanded.
  const pinnedCollapsed = collapsedPref && !mobileOpen;
  const collapsed = pinnedCollapsed && !peeking;
  // Groups the person opened, plus the one the current page is in.
  const [openGroups, setOpenGroups] = useState(() => new Set());

  const toggleCollapsed = useCallback(() => {
    setCollapsedPref((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // the choice still applies for this visit
      }
      return next;
    });
    setPeeking(false);
  }, []);

  const startPeek = useCallback(() => {
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setPeeking(true), HOVER_OPEN_MS);
  }, []);
  const endPeek = useCallback(() => {
    window.clearTimeout(peekTimer.current);
    setPeeking(false);
  }, []);
  useEffect(() => () => window.clearTimeout(peekTimer.current), []);

  // Arriving on a page inside a group opens that group; leaving it does not close it again.
  useEffect(() => {
    const current = links.filter((l) => groupIsCurrent(l, pathname)).map((l) => l.to);
    if (current.length === 0) return;
    setOpenGroups((open) => (current.every((to) => open.has(to)) ? open : new Set([...open, ...current])));
  }, [pathname, links]);

  function toggleGroup(to) {
    setOpenGroups((open) => {
      const next = new Set(open);
      if (next.has(to)) next.delete(to);
      else next.add(to);
      return next;
    });
  }
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
    // The slot keeps the rail's width in the page, so opening the rail on hover covers the page
    // instead of pushing it sideways.
    <div className={"sidebar-slot" + (pinnedCollapsed ? " sidebar-slot-collapsed" : "")}>
      <aside
        className={
          "sidebar" +
          (collapsed ? " sidebar-collapsed" : "") +
          (pinnedCollapsed && peeking ? " sidebar-peek" : "") +
          (mobileOpen ? " sidebar-open" : "")
        }
        onMouseEnter={pinnedCollapsed ? startPeek : undefined}
        onMouseLeave={pinnedCollapsed ? endPeek : undefined}
        onFocus={pinnedCollapsed ? () => { window.clearTimeout(peekTimer.current); setPeeking(true); } : undefined}
        onBlur={pinnedCollapsed ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) endPeek(); } : undefined}
      >
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
            const hasChildren = Boolean(link.children);
            const groupOpen = hasChildren && openGroups.has(link.to);
            return (
              <div key={link.to} className="sidebar-item">
                <NavLink
                  to={link.to}
                  end={link.to.startsWith("/dashboard") || Boolean(link.end)}
                  className={({ isActive }) =>
                    "sidebar-link" + (isActive ? " sidebar-link-active" : "") + (hasChildren && !collapsed ? " sidebar-link-group" : "")
                  }
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
                {hasChildren && !collapsed && (
                  <button
                    type="button"
                    className="sidebar-group-toggle"
                    onClick={() => toggleGroup(link.to)}
                    aria-expanded={groupOpen}
                    aria-label={t(groupOpen ? "nav.hide_group" : "nav.show_group", { name: t(link.label) })}
                  >
                    <ChevronIcon open={groupOpen} />
                  </button>
                )}
                {groupOpen && !collapsed && (
                  <div className="sidebar-sublinks">
                    {link.children.map((child) => (
                      <NavLink
                        key={child.to}
                        to={child.to}
                        className={({ isActive }) => "sidebar-sublink" + (isActive ? " sidebar-sublink-active" : "")}
                        onClick={onNavigate}
                      >
                        {t(child.label)}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <NavLink
            to="/account"
            className={({ isActive }) => "sidebar-link sidebar-link-settings" + (isActive ? " sidebar-link-active" : "")}
            title={collapsed ? t("nav.settings") : undefined}
            onClick={onNavigate}
          >
            <span className="sidebar-link-icon"><GearIcon /></span>
            {!collapsed && <span className="sidebar-link-label">{t("nav.settings")}</span>}
          </NavLink>
        </nav>

        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={toggleCollapsed}
          aria-label={t(collapsedPref ? "nav.expand_sidebar" : "nav.collapse_sidebar")}
        >
          <ChevronIcon open={!collapsedPref} />
          {!collapsed && <span>{t(collapsedPref ? "nav.expand_sidebar" : "nav.collapse")}</span>}
        </button>

        <div className="sidebar-footer">
          {!collapsed && <p className="sidebar-footer-label">{t("nav.signed_in_as")}</p>}
          <p className="sidebar-footer-role">{collapsed ? user?.role?.[0] : user?.role}</p>
        </div>
      </aside>
    </div>
  );
}
