import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { ChevronIcon, LogoutIcon, BellIcon } from "./icons";
import {
  listMyNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "../../api/notificationsApi";
import "./Topbar.css";

const POLL_INTERVAL_MS = 30_000; // check for new notifications every 30s

// Purely cosmetic label map for the topbar title/breadcrumb — does not
// affect routing. Falls back to a generic label for any unmatched or
// dynamic (":id") route rather than showing nothing.
const PAGE_LABELS = [
  { test: (p) => p.startsWith("/dashboard"), label: "Dashboard", crumb: "Home" },
  { test: (p) => p === "/projects", label: "Projects", crumb: "Projects" },
  { test: (p) => p === "/projects/new", label: "Create Project", crumb: "Projects / New" },
  { test: (p) => /^\/projects\/[^/]+$/.test(p), label: "Project Detail", crumb: "Projects / Detail" },
  { test: (p) => p.includes("/milestones/new"), label: "Add Milestone", crumb: "Projects / Milestones / New" },
  { test: (p) => p.includes("/tasks/new"), label: "Add Task", crumb: "Projects / Tasks / New" },
  { test: (p) => p === "/expenses", label: "Expenses", crumb: "Finance" },
  { test: (p) => p === "/admin/users", label: "User Accounts", crumb: "Administration" },
  { test: (p) => p === "/blockchain/verify", label: "Verify Expense", crumb: "Blockchain Audit" },
  { test: (p) => p === "/blockchain/alerts", label: "Tamper Alerts", crumb: "Blockchain Audit" },
];

function pageInfoFor(pathname) {
  const match = PAGE_LABELS.find((entry) => entry.test(pathname));
  return match || { label: "Brick x Brick", crumb: "" };
}

export function Topbar({ onMenuClick }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const { label, crumb } = pageInfoFor(location.pathname);
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

  function openNotifications() {
    setNotifOpen((v) => {
      const next = !v;
      if (next) {
        listMyNotifications()
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

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button type="button" className="topbar-menu-btn" onClick={onMenuClick} aria-label="Open navigation">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
        </button>

        <div className="topbar-titles">
          <h1 className="topbar-page-title">{label}</h1>
          {crumb && <p className="topbar-breadcrumb">{crumb}</p>}
        </div>

        <span className="topbar-spacer" />

        <div className="topbar-actions">
          <div className="topbar-notif" ref={notifRef}>
            <button
              type="button"
              className="topbar-icon-btn"
              aria-label="Notifications"
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
                  <p className="topbar-menu-name">Notifications</p>
                  {unreadCount > 0 && (
                    <button type="button" className="topbar-notif-markall" onClick={handleMarkAllRead}>
                      Mark all read
                    </button>
                  )}
                </div>

                {notifications.length === 0 ? (
                  <p className="topbar-notif-empty">No notifications yet.</p>
                ) : (
                  <ul className="topbar-notif-list">
                    {notifications.map((n) => (
                      <li
                        key={n.notificationid}
                        className={"topbar-notif-item" + (n.isread ? "" : " topbar-notif-item-unread")}
                        onClick={() => !n.isread && handleMarkRead(n.notificationid)}
                      >
                        <p className="topbar-notif-message">{n.message}</p>
                        <p className="topbar-notif-time">
                          {new Date(n.createdat).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
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
                <button
                  type="button"
                  className="topbar-menu-item topbar-menu-logout"
                  role="menuitem"
                  onClick={logout}
                >
                  <LogoutIcon />
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
