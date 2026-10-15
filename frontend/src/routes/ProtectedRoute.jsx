import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { TermsAcceptPage } from "../pages/Legal/TermsAcceptPage";

export function ProtectedRoute({ children }) {
  const { status, user } = useAuth();

  if (status === "loading") {
    return <div className="route-loading">Loading…</div>;
  }
  if (status === "guest") {
    return <Navigate to="/login" replace />;
  }
  // Data Privacy Act (RA 10173): nothing else opens until the current Terms of
  // Use and Privacy Notice are accepted. `=== false` so an older backend that
  // doesn't send the flag never locks anyone out.
  if (user?.termsAccepted === false) {
    return <TermsAcceptPage />;
  }
  return children;
}
