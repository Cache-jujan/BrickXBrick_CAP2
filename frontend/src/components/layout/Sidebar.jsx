import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { GridIcon, FolderIcon, UsersIcon } from "./icons";
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

const NAV_BY_ROLE = {
  "General Manager": [
    { to: "/dashboard/gm", label: "Dashboard", icon: GridIcon },
    { to: "/projects", label: "Projects", icon: FolderIcon },
    { to: "/blockchain/alerts", label: "Tamper Alerts", icon: AlertTriangleIcon },
  ],
  "Project Manager": [
    { to: "/dashboard/pm", label: "Dashboard", icon: GridIcon },
    { to: "/projects", label: "Projects", icon: FolderIcon },
  ],
  "Site Manager": [{ to: "/dashboard/sm", label: "Dashboard", icon: GridIcon }],
  Purchaser: [{ to: "/dashboard/purchaser", label: "Dashboard", icon: GridIcon }],
  "System Administrator": [
    { to: "/dashboard/admin", label: "Dashboard", icon: GridIcon },
    { to: "/admin/users", label: "User Accounts", icon: UsersIcon },
    { to: "/blockchain/alerts", label: "Tamper Alerts", icon: AlertTriangleIcon },
  ],
};

export function Sidebar() {
  const { user } = useAuth();
  const links = NAV_BY_ROLE[user?.role] || [];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src="/images/logo.png" alt="" className="sidebar-logo" />
        <span className="sidebar-brand-name">
          Brick <span className="sidebar-brand-x">x</span> Brick
        </span>
      </div>

      <nav className="sidebar-nav">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to.startsWith("/dashboard")}
              className={({ isActive }) => "sidebar-link" + (isActive ? " sidebar-link-active" : "")}
            >
              <Icon />
              {link.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <p className="sidebar-footer-label">Signed in as</p>
        <p className="sidebar-footer-role">{user?.role}</p>
      </div>
    </aside>
  );
}