import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/**
 * Gate a route to specific roles, mirroring requireRole(...) on the
 * backend. This is a UX convenience only — the backend is still the
 * real enforcement point, so this never needs to be "secure" on its own.
 */
export function RoleRoute({ allow, children }) {
  const { user } = useAuth();

  if (!user || !allow.includes(user.role)) {
    return <Navigate to="/not-authorized" replace />;
  }
  return children;
}
