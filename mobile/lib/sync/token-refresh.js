// Keeps the sign-in alive without asking for the password again.
//
// The server's sign-in token only lasts a while (Supabase's default is an hour),
// and a Site Manager can be offline far longer than that. Without this, the
// first request after reconnecting is refused, queued work cannot be sent and
// the person is thrown back to the sign-in screen. With a refresh token saved
// on the phone, the app swaps it for a new sign-in token in the background
// (POST /api/auth/refresh) and carries on.
//
// A refresh token works ONCE: the answer carries the next one, and the app must
// keep it. So only one refresh may run at a time; a second caller waits for the
// first and shares its answer.
//
// refreshSession() answers with one of:
//   "refreshed"    new tokens are saved on the phone
//   "rejected"     the server says this sign-in is over (expired, used, revoked,
//                  deactivated, locked): the person must sign in again
//   "later"        could not tell (no connection, server trouble): keep the
//                  sign-in, keep the queue, try again later. NEVER a sign-out.
//   "unavailable"  nothing to refresh with (signed out, an older sign-in saved
//                  before refresh existed, or a server without the route)
//
// No React Native imports, so the tests can run it in plain Node.
// `fetchFn` and `nowMs` are for tests.

// Refresh this many seconds BEFORE the token ends, so a request that is already
// on its way does not arrive with a token that just expired.
const REFRESH_AHEAD_SECONDS = 60;
// A phone with a bad signal can leave a request hanging; do not wait for ever.
const REQUEST_TIMEOUT_MS = 10_000;
// After a refresh that could not be tried (offline), ensureFreshToken does not
// try again for this long, so a screen full of requests does not each wait on it.
const RETRY_AFTER_LATER_MS = 10_000;

/**
 * @param {{
 *   getSession: () => (null | { token: string, refreshToken?: string, expiresAt?: number, user: { id: string } }),
 *   setSession: (session: any) => void,
 *   apiUrl: string,
 *   fetchFn?: (url: string, init: any) => Promise<any>,
 *   nowMs?: () => number,
 *   timeoutMs?: number,
 * }} deps
 */
export function createTokenRefresher({
  getSession,
  setSession,
  apiUrl,
  fetchFn = (url, init) => fetch(url, init),
  nowMs = () => Date.now(),
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  /** @type {Promise<string> | null} */
  let inFlight = null;
  let lastLaterAt = -Infinity;

  function refreshSession() {
    const current = getSession();
    if (!current || !current.refreshToken) return Promise.resolve("unavailable");
    if (inFlight) return inFlight;

    const attempt = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchFn(`${apiUrl}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: current.refreshToken }),
          signal: controller.signal,
        });
        if (res.status === 404) return "unavailable"; // a server from before this existed
        if (res.status === 401 || res.status === 403 || res.status === 423) return "rejected";
        if (!res.ok) return "later";

        const data = await res.json();
        if (!data || !data.token || !data.refreshToken) return "later";

        // They may have signed out, or someone else signed in on this phone,
        // while the request was running. The answer belongs to the person who
        // asked, so it is never saved for anyone else.
        const latest = getSession();
        if (!latest || latest.user.id !== current.user.id) return "later";

        setSession({ ...latest, token: data.token, refreshToken: data.refreshToken, expiresAt: data.expiresAt });
        return "refreshed";
      } catch {
        return "later"; // no connection, timeout...
      } finally {
        clearTimeout(timer);
      }
    })();
    // Cleared in a .then (always after this assignment), never inside the async
    // function: if that finished before the assignment, inFlight would stay set
    // for ever and every later refresh would get the old answer.
    inFlight = attempt.then((outcome) => {
      inFlight = null;
      if (outcome === "later") lastLaterAt = nowMs();
      return outcome;
    });
    return inFlight;
  }

  // Before sending something: refresh first when the token is about to end (or
  // already has). "fresh" means no refresh was needed or possible; otherwise it
  // is the outcome of refreshSession().
  async function ensureFreshToken() {
    const current = getSession();
    if (!current || !current.refreshToken || !current.expiresAt) return "fresh";
    if (current.expiresAt - nowMs() / 1000 > REFRESH_AHEAD_SECONDS) return "fresh";
    if (nowMs() - lastLaterAt < RETRY_AFTER_LATER_MS) return "later";
    return refreshSession();
  }

  return { refreshSession, ensureFreshToken };
}
