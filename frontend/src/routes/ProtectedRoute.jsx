import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function ProtectedRoute({ children }) {
  const { status } = useAuth();

  if (status === "loading") {
    return <div className="route-loading">Loading…</div>;
  }
  if (status === "guest") {
    return <Navigate to="/login" replace />;
  }
  return children;
}
