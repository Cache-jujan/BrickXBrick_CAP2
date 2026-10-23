// supabaseRefresh.js — swap a Supabase refresh token for a new access token.
//
// It calls Supabase's token endpoint directly instead of going through
// supabaseAnon.auth.refreshSession: that client is shared by every request, and
// supabase-js hands a refresh that starts while another is running the FIRST
// caller's session. Two people refreshing at the same moment must never be able
// to receive each other's tokens, so there is no shared state here.
//
// Returns
//   { ok: true,  session: { accessToken, refreshToken, expiresAt, supabaseUserId } }
//   { ok: false }                    Supabase says this refresh token is no good
// Throws when Supabase could not be asked or is having a problem (network, 5xx,
// 429): that is not "signed out", the phone just tries again later.
// `fetchFn` is for tests.

const TIMEOUT_MS = 10_000;

async function refreshWithSupabase(refreshToken, fetchFn = fetch) {
  const base = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const response = await fetchFn(`${base}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_ANON_KEY || "" },
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  let body = {};
  try {
    body = await response.json();
  } catch {
    // not JSON; the status below decides
  }

  if (response.ok && body.access_token && body.refresh_token) {
    return {
      ok: true,
      session: {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresAt: body.expires_at,
        supabaseUserId: body.user && body.user.id,
      },
    };
  }
  if (response.status >= 500 || response.status === 429) {
    throw new Error(`Supabase answered ${response.status}`);
  }
  return { ok: false };
}

module.exports = { refreshWithSupabase };
