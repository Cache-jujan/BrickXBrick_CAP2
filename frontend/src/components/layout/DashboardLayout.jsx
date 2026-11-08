import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ReceiptScanProvider } from "../../context/ReceiptScanContext";
import { useAuth } from "../../context/AuthContext";
import "../../styles/gm-skin.css";

export function DashboardLayout() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const { user } = useAuth();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // The General Manager's pages share one skin (styles/gm-skin.css). The dashboard keeps
  // its own styles, and every other role keeps the shared look.
  const gmSkin = user?.role === "General Manager" && !location.pathname.startsWith("/dashboard");

  // The scan provider lives here, not on a page, so a receipt keeps being tracked (and the
  // "ready" pop-up can appear) while the user moves between pages.
  return (
    <ReceiptScanProvider>
    <div className="app-shell">
      <Sidebar mobileOpen={navOpen} onNavigate={() => setNavOpen(false)} />
      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
      <div className="app-content">
        <Topbar onMenuClick={() => setNavOpen(true)} />
        <main className={"container page" + (gmSkin ? " gm-skin" : "")}>
          <Outlet />
        </main>
      </div>
    </div>
    </ReceiptScanProvider>
  );
}
