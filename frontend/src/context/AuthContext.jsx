import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { login as loginRequest, fetchCurrentUser } from "../api/authApi";
import { registerUnauthorizedHandler } from "../api/client";

const AuthContext = createContext(null);

// Mirrors ROLE_DASHBOARDS in routes/auth.js on the backend, so the
// frontend's post-login redirect always agrees with what the server sent.
export const ROLE_DASHBOARDS = {
  "General Manager": "/dashboard/gm",
  "Project Manager": "/dashboard/pm",
  "Site Manager": "/dashboard/sm",
  Purchaser: "/dashboard/purchaser",
  "System Administrator": "/dashboard/admin",
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("loading"); // "loading" | "authenticated" | "guest"

  // On first load, if a token is already stored, try to restore the
  // session via /api/me rather than trusting stale localStorage data.
  useEffect(() => {
    const token = localStorage.getItem("bxb_token");
    if (!token) {
      setStatus("guest");
      return;
    }
    fetchCurrentUser()
      .then((restoredUser) => {
        setUser(restoredUser);
        setStatus("authenticated");
      })
      .catch(() => {
        localStorage.removeItem("bxb_token");
        setStatus("guest");
      });
  }, []);

  useEffect(() => {
    registerUnauthorizedHandler(() => {
      localStorage.removeItem("bxb_token");
      setUser(null);
      setStatus("guest");
    });
  }, []);

  async function login(email, password) {
    const result = await loginRequest(email, password);
    localStorage.setItem("bxb_token", result.token);
    setUser(result.user);
    setStatus("authenticated");
    return result;
  }

  // Called after the user accepts the Terms of Use / Privacy Notice
  // (pages/Legal/TermsAcceptPage.jsx), so the app opens without a reload.
  function markTermsAccepted(version) {
    setUser((current) => (current ? { ...current, termsAccepted: true, termsVersion: version } : current));
  }

  // Called after the user saves a new username (pages/Account/AccountPage.jsx).
  function markUsernameChanged(username, name) {
    setUser((current) => (current ? { ...current, username, name } : current));
  }

  function logout() {
    localStorage.removeItem("bxb_token");
    setUser(null);
    setStatus("guest");
  }

  const value = useMemo(
    () => ({ user, status, login, logout, markTermsAccepted, markUsernameChanged }),
    [user, status]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
