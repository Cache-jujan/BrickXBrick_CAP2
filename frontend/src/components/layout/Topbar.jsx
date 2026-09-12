import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { ChevronIcon, LogoutIcon, BellIcon } from "./icons";
import "./Topbar.css";

export function Topbar() {
  const { user, logout } = useAuth();
  const initial = user?.name?.trim()?.[0]?.toUpperCase() || "?";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    function handleEscape(e) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <span className="topbar-spacer" />

        <div className="topbar-actions">
          <button type="button" className="topbar-icon-btn" aria-label="Notifications">
            <BellIcon />
          </button>

          <div className="topbar-user" ref={menuRef}>
            <button
              type="button"
              className="topbar-user-trigger"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={menuOpen}
            >
              <span className="topbar-avatar">{initial}</span>
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
