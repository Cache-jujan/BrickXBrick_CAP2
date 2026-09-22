import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ROLE_DASHBOARDS } from "../context/AuthContext";
import "./NotAuthorizedPage.css";

export function NotAuthorizedPage() {
  const { user } = useAuth();
  const home = user ? ROLE_DASHBOARDS[user.role] || "/" : "/login";

  return (
    <div className="not-authorized">
      <div className="not-authorized-card">
        <p className="not-authorized-code">403</p>
        <h1>Not authorized</h1>
        <p className="not-authorized-body">
          Your account doesn't have access to that page. If you think this is a mistake,
          contact your System Administrator.
        </p>
        <Link to={home} className="btn btn-primary">
          {user ? "Back to dashboard" : "Go to sign in"}
        </Link>
      </div>
    </div>
  );
}
