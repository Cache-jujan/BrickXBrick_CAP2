import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ReceiptScanProvider } from "../../context/ReceiptScanContext";

export function DashboardLayout() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // The scan provider lives here, not on a page, so a receipt keeps being tracked (and the
  // "ready" pop-up can appear) while the user moves between pages.
  return (
    <ReceiptScanProvider>
    <div className="app-shell">
      <Sidebar mobileOpen={navOpen} onNavigate={() => setNavOpen(false)} />
      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
      <div className="app-content">
        <Topbar onMenuClick={() => setNavOpen(true)} />
        <main className="container page">
          <Outlet />
        </main>
      </div>
    </div>
    </ReceiptScanProvider>
  );
}
