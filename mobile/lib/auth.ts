import { API_URL, setAuthToken } from "@/constants/api";

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

export function getSession() {
  return session;
}

export function setSession(nextSession: MobileSession | null) {
  session = nextSession;
  setAuthToken(nextSession?.token ?? "");
}

export async function login(email: string, password: string): Promise<MobileSession> {
  const response = await fetch(`${API_URL}/api/auth/login`, {
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
}

export function logout() {
  setSession(null);
}
