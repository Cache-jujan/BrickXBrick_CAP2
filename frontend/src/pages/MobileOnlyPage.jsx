import { useAuth } from "../context/AuthContext";
import "./MobileOnlyPage.css";

// Full-screen wall for roles that have no web app at all (Site Manager,
// Purchaser). Rendered at the app entry instead of the dashboard shell, so
// there's no sidebar and no reachable web page — just a prompt to use the
// mobile app, and a way to sign out.
export function MobileOnlyPage() {
  const { user, logout } = useAuth();
  const first = user?.name ? user.name.split(" ")[0] : "there";

  return (
    <div className="mobile-wall">
      <div className="mobile-wall-card">
        <img src="/images/logo.png" alt="" className="mobile-wall-logo" />
        <h1 className="mobile-wall-title">Use the Brick x Brick app</h1>
        <p className="mobile-wall-text">
          Hi {first} — the {user?.role} role works entirely from the Brick x Brick
          mobile app. There's nothing here on the web. Open the app on your Android
          device to continue.
        </p>
        <button type="button" className="btn btn-secondary mobile-wall-logout" onClick={logout}>
          Log out
        </button>
      </div>
    </div>
  );
}