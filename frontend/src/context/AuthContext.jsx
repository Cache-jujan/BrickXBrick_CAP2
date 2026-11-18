import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { login as loginRequest, fetchCurrentUser } from "../api/authApi";
import { registerUnauthorizedHandler, saveSession, clearSession } from "../api/client";

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
        clearSession();
        setStatus("guest");
      });
  }, []);

  useEffect(() => {
    registerUnauthorizedHandler(() => {
      clearSession();
      setUser(null);
      setStatus("guest");
    });
  }, []);

  async function login(email, password) {
    const result = await loginRequest(email, password);
    // The refresh token and expiry let api/client.js renew the sign-in quietly
    // before the 1-hour access token ends.
    saveSession({ token: result.token, refreshToken: result.refreshToken, expiresAt: result.expiresAt });
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

  // Called after the user sets or removes their profile picture (pages/Account/AccountPage.jsx).
  function markAvatarChanged(avatarUrl) {
    setUser((current) => (current ? { ...current, avatarUrl } : current));
  }

  function logout() {
    clearSession();
    setUser(null);
    setStatus("guest");
  }

  const value = useMemo(
    () => ({ user, status, login, logout, markTermsAccepted, markUsernameChanged, markAvatarChanged }),
    [user, status]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
