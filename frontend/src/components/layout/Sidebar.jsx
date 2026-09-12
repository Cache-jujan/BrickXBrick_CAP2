import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { GridIcon, FolderIcon, UsersIcon } from "./icons";
import "./Sidebar.css";

const NAV_BY_ROLE = {
  "General Manager": [
    { to: "/dashboard/gm", label: "Dashboard", icon: GridIcon },
    { to: "/projects", label: "Projects", icon: FolderIcon },
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
