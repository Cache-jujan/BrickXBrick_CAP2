import { router } from "expo-router";

import { API_URL, setAuthToken } from "@/constants/api";
import { initDb, kvDelete, kvGet, kvSet } from "@/lib/sync/db";
import { fetchWithRetry } from "@/lib/retry-fetch";

export type MobileRole = "Purchaser" | "Site Manager";

export type MobileUser = {
  id: string;
  name: string;
  email: string;
  role: MobileRole;
  // false until the current Terms of Use / Privacy Notice is accepted
  // (app/terms.tsx). Missing on an older backend: treated as accepted.
  termsAccepted?: boolean;
  termsVersion?: string;
};

export type MobileSession = {
  token: string;
  user: MobileUser;
};

let session: MobileSession | null = null;

// Offline-first: the sign-in is saved on the phone (in the app's own private
// SQLite file), so the app opens and shows your saved work with no connection.
// Signing in itself still needs the server.
const SESSION_KEY = "session";
let sessionExpired = false;

function persistSession(next: MobileSession | null) {
  try {
    initDb();
    if (next) kvSet(SESSION_KEY, JSON.stringify(next));
    else kvDelete(SESSION_KEY);
  } catch {
    // Saving is a convenience; the app still works for this run without it.
  }
}

export function getSession() {
  return session;
}

export function setSession(nextSession: MobileSession | null) {
  session = nextSession;
  setAuthToken(nextSession?.token ?? "");
  persistSession(nextSession);
  if (nextSession) sessionExpired = false;
}

// Called once when the app starts (app/_layout.tsx), before any screen reads
// the session. Works offline: nothing is checked with the server here.
export function restoreSession(): MobileSession | null {
  if (session) return session;
  try {
    initDb();
    const raw = kvGet(SESSION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as MobileSession;
    if (!saved?.token || !saved?.user?.id) return null;
    session = saved;
    setAuthToken(saved.token);
    return saved;
  } catch {
    return null;
  }
}

// The server said the saved sign-in is no longer valid (it expired). Sign out
// and go to the sign-in screen; everything saved on the phone stays queued and
// is sent after signing in again.
export function handleUnauthorized() {
  if (!session) return;
  setSession(null);
  sessionExpired = true;
  try {
    router.replace("/login");
  } catch {
    // Not mounted yet: the next screen that checks the session redirects.
  }
}

// For the sign-in screen: true once, right after an expired sign-in.
export function consumeSessionExpired() {
  const was = sessionExpired;
  sessionExpired = false;
  return was;
}

export async function login(email: string, password: string): Promise<MobileSession> {
  // Signing in twice is harmless, so a dead reused connection is retried
  // instead of telling the user to check their internet.
  const response = await fetchWithRetry(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim(), password }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Unable to sign in. Check your email and password.");
  }

  if (data.user?.role !== "Purchaser" && data.user?.role !== "Site Manager") {
    throw new Error("This mobile app is currently available to Purchasers and Site Managers only.");
  }

  const nextSession: MobileSession = {
    token: data.token,
    user: data.user,
  };
  setSession(nextSession);
  return nextSession;
}

// Where each role lands after sign-in.
export function homeRouteFor(role: MobileRole) {
  return role === "Site Manager" ? "/site-manager" : "/(tabs)";
}

// Where to go right after sign-in: the terms screen first if needed.
export function nextRouteAfterLogin(user: MobileUser) {
  return user.termsAccepted === false ? "/terms?accept=1" : homeRouteFor(user.role);
}

// Called by app/terms.tsx once the user has accepted the current version.
export function setTermsAccepted(version: string) {
  if (!session) return;
  session = { ...session, user: { ...session.user, termsAccepted: true, termsVersion: version } };
  persistSession(session);
}

export function logout() {
  setSession(null);
}
