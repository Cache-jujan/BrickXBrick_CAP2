// One fetch for every call to our API (lib/api.ts, lib/receipt-scans.ts).
// Rules on top of fetch:
// - Before sending, a sign-in token that is about to end is swapped for a new
//   one (refresh token, lib/sync/token-refresh.js), so being offline for hours
//   does not log anyone out.
// - A 401 means the token was refused: refresh it and send the request once
//   more. Only when the server says the sign-in is really over (or there is
//   nothing to refresh with) is the user sent to the sign-in screen with an
//   explanation (handleUnauthorized). Queued offline work is kept and sent
//   after they sign in again. If the refresh could not be tried (no
//   connection), nobody is signed out.
// - Reads (GET) are retried once on a dead reused connection
//   (lib/retry-fetch.ts); writes are sent once, so nothing is saved twice.
import { ensureFreshToken, getSession, handleUnauthorized, refreshSession } from "@/lib/auth";
import { getAuthToken } from "@/constants/api";
import { fetchWithRetry } from "@/lib/retry-fetch";

// The caller built its headers with the token of that moment. Put the current
// token in, so a request made after a refresh (or a retry) carries the new one.
function withCurrentToken(init?: RequestInit): RequestInit | undefined {
  const token = getAuthToken();
  if (!init?.headers || !token) return init;
  const headers = new Headers(init.headers);
  if (headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const send = () => (method === "GET" ? fetchWithRetry(input, withCurrentToken(init)) : fetch(input, withCurrentToken(init)));

  await ensureFreshToken();
  let res = await send();
  if (res.status !== 401 || !getSession()) return res;

  const outcome = await refreshSession();
  if (outcome === "refreshed") {
    // A 401 means the request was not processed, so sending it again is safe.
    res = await send();
    if (res.status === 401) handleUnauthorized();
  } else if (outcome !== "later") {
    handleUnauthorized(); // "rejected" or "unavailable": sign in again
  }
  return res;
}
