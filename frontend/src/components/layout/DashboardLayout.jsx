import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ReceiptScanProvider } from "../../context/ReceiptScanContext";
import { useAuth } from "../../context/AuthContext";
import "../../styles/gm-skin.css";
import "../../styles/pm-skin.css";

export function DashboardLayout() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const { user } = useAuth();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // Every web role's pages share one skin (styles/gm-skin.css), so the web app reads as one
  // product. The dashboard keeps its own styles. The Project Manager also gets small additions of their own
  // (styles/pm-skin.css) for the pages only they use.
  const webSkin = ["General Manager", "Project Manager", "System Administrator"].includes(user?.role) && !location.pathname.startsWith("/dashboard");
  const skinClass = webSkin
    ? " gm-skin" + (user.role === "Project Manager" ? " pm-skin" : "")
    : user?.role === "Project Manager" && location.pathname.startsWith("/dashboard")
      ? " pm-dash"
      : "";

  // The scan provider lives here, not on a page, so a receipt keeps being tracked (and the
  // "ready" pop-up can appear) while the user moves between pages.
  return (
    <ReceiptScanProvider>
    <div className="app-shell">
      <Sidebar mobileOpen={navOpen} onNavigate={() => setNavOpen(false)} />
      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
      <div className="app-content">
        <Topbar onMenuClick={() => setNavOpen(true)} />
        <main className={"container page" + skinClass}>
          <Outlet />
        </main>
      </div>
    </div>
    </ReceiptScanProvider>
  );
}
