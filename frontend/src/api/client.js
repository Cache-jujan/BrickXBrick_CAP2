import axios from "axios";

// Base URL comes from Vite env: set VITE_API_URL in .env (see .env.example).
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// --- Session storage -------------------------------------------------------
// The sign-in is a short-lived access token (1 hour) plus a refresh token that
// swaps it for a new one. Both live in localStorage; expiresAt is unix seconds.
const TOKEN_KEY = "bxb_token";
const REFRESH_KEY = "bxb_refresh";
const EXPIRES_KEY = "bxb_expires";

// Refresh a little before the token ends, so a request never leaves with a
// token that dies on the way.
const REFRESH_MARGIN_SECONDS = 60;

export function saveSession({ token, refreshToken, expiresAt }) {
  localStorage.setItem(TOKEN_KEY, token);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  else localStorage.removeItem(REFRESH_KEY);
  if (expiresAt) localStorage.setItem(EXPIRES_KEY, String(expiresAt));
  else localStorage.removeItem(EXPIRES_KEY);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(EXPIRES_KEY);
}

// Pages that predate the refresh token (signed in before this update) have a
// token but nothing to refresh with: they keep working until the token ends.
function hasRefreshToken() {
  return Boolean(localStorage.getItem(REFRESH_KEY));
}

function tokenEndsSoon() {
  const expiresAt = Number(localStorage.getItem(EXPIRES_KEY));
  if (!expiresAt) return false;
  return expiresAt - Date.now() / 1000 < REFRESH_MARGIN_SECONDS;
}

// --- Refresh ---------------------------------------------------------------
// A refresh token works only once, so two requests must never refresh at the
// same time: they all wait for the same call.
let refreshInFlight = null;

// Resolves "refreshed" (new token saved), "rejected" (the server says the
// sign-in is over: sign out) or "later" (could not reach the server: keep the
// session and let the request fail on its own).
async function runRefresh() {
  const used = localStorage.getItem(REFRESH_KEY);
  if (!used) return "rejected";
  try {
    // Plain axios, not apiClient: this call must not go through the
    // interceptors below.
    const { data } = await axios.post(`${BASE_URL}/api/auth/refresh`, { refreshToken: used });
    saveSession({ token: data.token, refreshToken: data.refreshToken, expiresAt: data.expiresAt });
    return "refreshed";
  } catch (error) {
    const status = error.response?.status;
    if (status === 400 || status === 401 || status === 403 || status === 423) {
      // Another tab may have refreshed first (its new refresh token is now in
      // storage); that tab's result is just as good for us.
      if (localStorage.getItem(REFRESH_KEY) !== used) return "refreshed";
      return "rejected";
    }
    return "later"; // offline, 5xx, or Supabase unavailable (503)
  }
}

function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = runRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

function isAuthRoute(config) {
  const url = config?.url || "";
  return url.includes("/api/auth/login") || url.includes("/api/auth/refresh");
}

// Centralize the "your session died" case. Once a refresh has also failed,
// 401 here means the sign-in is really over.
let onUnauthorized = () => {};
export function registerUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// Attach the stored token to every outgoing request, if we have one. A token
// that is about to end is swapped for a new one first.
apiClient.interceptors.request.use(async (config) => {
  if (!isAuthRoute(config) && hasRefreshToken() && tokenEndsSoon()) {
    const outcome = await refreshSession();
    if (outcome === "rejected") onUnauthorized();
  }
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (error.response?.status !== 401) return Promise.reject(error);

    // A wrong password on the sign-in form is not a dead session.
    if (isAuthRoute(config)) {
      if (!config?.url?.includes("/api/auth/login")) onUnauthorized();
      return Promise.reject(error);
    }

    // The token was refused. Refresh once and send the same request again; a
    // 401 means it was not processed, so sending it twice is safe.
    if (hasRefreshToken() && config && !config._retried) {
      const outcome = await refreshSession();
      if (outcome === "refreshed") {
        config._retried = true;
        return apiClient(config);
      }
      if (outcome === "later") return Promise.reject(error); // do not sign anyone out for a bad connection
    }

    onUnauthorized();
    return Promise.reject(error);
  }
);

// Normalizes backend error shapes ({ error: "..." }) into a plain string
// so pages don't each re-implement this.
export function extractErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  return error?.response?.data?.error || fallback;
}
