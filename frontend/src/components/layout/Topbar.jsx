import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { ChevronIcon, LogoutIcon, BellIcon } from "./icons";
import {
  listMyNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "../../api/notificationsApi";
import { subscribeNotificationsRefresh } from "../../utils/notificationSync";
import { humanizeNotification } from "../../utils/plainLanguage";
import { metaFor, relativeTime, groupByDay, routeForNotification } from "../../utils/notificationMeta";
import { useLocale } from "../../i18n/LocaleProvider";
import { LanguageToggle } from "../../i18n/LanguageToggle";
import "./Topbar.css";

const POLL_INTERVAL_MS = 30_000; // check for new notifications every 30s
const DROPDOWN_LIMIT = 8;

// Purely cosmetic label map for the topbar title/breadcrumb — does not
// affect routing. Falls back to a generic label for any unmatched or
// dynamic (":id") route rather than showing nothing.
// Each page renders its own <h1>, so the top bar only shows where the page
// sits ("Projects / Edit project") instead of repeating the title.
const PAGE_LABELS = [
  { test: (p) => p.startsWith("/dashboard"), trail: ["nav.dashboard"] },
  { test: (p) => p === "/projects", trail: ["nav.projects"] },
  { test: (p) => p === "/projects/new", trail: ["nav.projects", "nav.new_project"] },
  { test: (p) => /^\/projects\/[^/]+\/edit$/.test(p), trail: ["nav.projects", "nav.edit_project"] },
  { test: (p) => /^\/projects\/[^/]+\/bom$/.test(p), trail: ["nav.projects", "nav.bill_of_materials"] },
  { test: (p) => /^\/projects\/[^/]+$/.test(p), trail: ["nav.projects", "nav.project"] },
  { test: (p) => p === "/expenses", trail: ["nav.finance", "nav.expenses"] },
  { test: (p) => p === "/expenses/new", trail: ["nav.finance", "nav.submit_expense"] },
  { test: (p) => p === "/expenses/split", trail: ["nav.finance", "nav.split_receipt"] },
  { test: (p) => p === "/expenses/mine", trail: ["nav.finance", "nav.my_expenses"] },
  { test: (p) => p.startsWith("/tickets/new"), trail: ["nav.tickets", "nav.new_ticket"] },
  { test: (p) => p.startsWith("/tickets"), trail: ["nav.tickets"] },
  { test: (p) => p.startsWith("/tasks/progress-review"), trail: ["nav.tasks", "nav.progress_review"] },
  { test: (p) => p === "/admin/users", trail: ["nav.administration", "nav.user_accounts"] },
  { test: (p) => p === "/blockchain/alerts", trail: ["nav.record_protection", "nav.tamper_alerts"] },
  { test: (p) => p === "/notifications", trail: ["nav.notifications"] },
];

function pageInfoFor(pathname) {
  const match = PAGE_LABELS.find((entry) => entry.test(pathname));
  return match || { trail: ["Brick x Brick"] };
}

export function Topbar({ onMenuClick }) {
  const { t } = useLocale();
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { trail } = pageInfoFor(location.pathname);
  const initial = user?.name?.trim()?.[0]?.toUpperCase() || "?";

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const notifRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    }
    function handleEscape(e) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  // Poll unread count in the background so the badge stays current even
  // without opening the dropdown. Unchanged from the prior implementation —
  // cancelled/cleared on unmount, so no leaked interval or stale-state write.
  useEffect(() => {
    let cancelled = false;
    function poll() {
      getUnreadCount()
        .then((count) => { if (!cancelled) setUnreadCount(count); })
        .catch(() => {});
    }
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Another tab marked notifications read, or this tab was just switched back
  // to: refetch the badge, and the list too if the dropdown is open.
  const notifOpenRef = useRef(false);
  useEffect(() => { notifOpenRef.current = notifOpen; }, [notifOpen]);
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      getUnreadCount()
        .then((count) => { if (!cancelled) setUnreadCount(count); })
        .catch(() => {});
      if (notifOpenRef.current) {
        listMyNotifications({ limit: DROPDOWN_LIMIT })
          .then((rows) => { if (!cancelled) setNotifications(rows); })
          .catch(() => {});
      }
    }
    const unsubscribe = subscribeNotificationsRefresh(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  function openNotifications() {
    setNotifOpen((v) => {
      const next = !v;
      if (next) {
        listMyNotifications({ limit: DROPDOWN_LIMIT })
          .then(setNotifications)
          .catch(() => {});
      }
      return next;
    });
  }

  async function handleMarkRead(id) {
    await markNotificationRead(id);
    setNotifications((prev) =>
      prev.map((n) => (n.notificationid === id ? { ...n, isread: true } : n))
    );
    setUnreadCount((c) => Math.max(0, c - 1));
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, isread: true })));
    setUnreadCount(0);
  }

  // Whole row is clickable: mark read (if needed) then navigate, if this
  // notification's type has somewhere to go on the web app.
  function handleRowClick(n) {
    if (!n.isread) {
      markNotificationRead(n.notificationid).catch(() => {});
      setNotifications((prev) => prev.map((x) => (x.notificationid === n.notificationid ? { ...x, isread: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    const route = routeForNotification(n, user?.role);
    if (route) {
      setNotifOpen(false);
      navigate(route);
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button type="button" className="topbar-menu-btn" onClick={onMenuClick} aria-label={t("nav.open_navigation")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
        </button>

        <nav className="topbar-trail" aria-label={t("nav.breadcrumb")}>
          <ol>
            {trail.map((item, i) => (
              <li key={item} aria-current={i === trail.length - 1 ? "page" : undefined}>
                {t(item)}
              </li>
            ))}
          </ol>
        </nav>

        <span className="topbar-spacer" />

        <div className="topbar-actions">
          <LanguageToggle />
          <div className="topbar-notif" ref={notifRef}>
            <button
              type="button"
              className="topbar-icon-btn"
              aria-label={t("nav.notifications")}
              aria-haspopup="true"
              aria-expanded={notifOpen}
              onClick={openNotifications}
            >
              <BellIcon />
              {unreadCount > 0 && (
                <span className="topbar-notif-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
              )}
            </button>

            {notifOpen && (
              <div className="topbar-menu topbar-notif-menu" role="menu">
                <div className="topbar-menu-header topbar-notif-header">
                  <p className="topbar-menu-name">{t("nav.notifications")}</p>
                  {unreadCount > 0 && (
                    <button type="button" className="topbar-notif-markall" onClick={handleMarkAllRead}>
                      {t("notifications.mark_all_read")}
                    </button>
                  )}
                </div>

                <div className="topbar-notif-scroll">
                  {notifications.length === 0 ? (
                    <div className="topbar-notif-empty">
                          <p>{t("notifications.caught_up")}</p>
                          <p className="topbar-notif-empty-sub">{t("notifications.empty_help")}</p>
                    </div>
                  ) : (
                    groupByDay(notifications).map(([label, items]) => (
                      <div key={label} className="topbar-notif-group">
                        <p className="topbar-notif-group-label">{label}</p>
                        <ul className="topbar-notif-list">
                          {items.map((n) => {
                            const { Icon, bg, fg, fallback } = metaFor(n.type);
                            const clickable = !n.isread || routeForNotification(n, user?.role);
                            return (
                              <li
                                key={n.notificationid}
                                className={"topbar-notif-item" + (n.isread ? "" : " topbar-notif-item-unread") + (clickable ? "" : " topbar-notif-item-static")}
                                onClick={clickable ? () => handleRowClick(n) : undefined}
                              >
                                <span className="topbar-notif-icon" style={{ background: bg, color: fg }}>
                                  <Icon />
                                </span>
                                <span className="topbar-notif-body">
                                  <p className="topbar-notif-message">{humanizeNotification(n.message) || fallback}</p>
                                  <p className="topbar-notif-time">{relativeTime(n.createdat)}</p>
                                </span>
                                {!n.isread && <span className="topbar-notif-dot" aria-hidden="true" />}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))
                  )}
                </div>

                <button
                  type="button"
                  className="topbar-notif-footer"
                  onClick={() => { setNotifOpen(false); navigate("/notifications"); }}
                >
                  {t("notifications.see_all")}
                </button>
              </div>
            )}
          </div>

          <div className="topbar-user" ref={menuRef}>
            <button
              type="button"
              className="topbar-user-trigger"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={menuOpen}
            >
              <span className="topbar-avatar">{initial}</span>
              <span className="topbar-user-text">
                <span className="topbar-user-name">{user?.name}</span>
                <span className="topbar-user-role">{user?.role}</span>
              </span>
              <ChevronIcon open={menuOpen} />
            </button>

            {menuOpen && (
              <div className="topbar-menu" role="menu">
                <div className="topbar-menu-header">
                  <p className="topbar-menu-name">{user?.name}</p>
                  <p className="topbar-menu-email">{user?.email}</p>
                </div>
                <Link
                  to="/legal"
                  className="topbar-menu-item"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                >
                  {t("account.terms_privacy")}
                </Link>
                <button
                  type="button"
                  className="topbar-menu-item topbar-menu-logout"
                  role="menuitem"
                  onClick={logout}
                >
                  <LogoutIcon />
                  {t("account.logout")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
