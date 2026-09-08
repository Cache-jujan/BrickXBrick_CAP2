import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ROLE_DASHBOARDS } from "../context/AuthContext";

export function NotAuthorizedPage() {
  const { user } = useAuth();
  const home = user ? ROLE_DASHBOARDS[user.role] || "/" : "/login";

  return (
    <div className="container page">
      <h1>Not authorized</h1>
      <p style={{ marginTop: "0.5rem", color: "var(--color-ink-soft)" }}>
        You don't have access to that page.
      </p>
      <Link to={home} style={{ display: "inline-block", marginTop: "1.5rem" }}>
        Go back to your dashboard
      </Link>
    </div>
  );
}
