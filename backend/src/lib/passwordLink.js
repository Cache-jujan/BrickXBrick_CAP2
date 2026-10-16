// F1: where Supabase email links (new-account invite, password email) open.
//
// The link must point at the web app's /set-password page, and that exact
// address must be on the Supabase allow list (Authentication > URL
// Configuration > Redirect URLs). If it isn't, Supabase silently opens its
// Site URL instead and the new user lands on Sign in with no password.
//
// FRONTEND_URL (backend .env) wins. When it is missing, the address the
// System Administrator is using the web app from (the request's Origin) is
// used, so a local setup at http://127.0.0.1:5173 still works.

function frontendBase(env, origin) {
  const raw = (env.FRONTEND_URL || "").trim() || (origin || "").trim();
  if (!/^https?:\/\/[^/\s]+/i.test(raw)) return null;
  return raw.replace(/\/+$/, "");
}

/** Absolute /set-password URL for Supabase redirectTo, or undefined (Supabase then uses its Site URL). */
function setPasswordUrl(req, env = process.env) {
  const base = frontendBase(env, req?.get ? req.get("origin") : null);
  if (!base) {
    console.warn("FRONTEND_URL is not set: Supabase email links will open the Site URL instead of /set-password.");
    return undefined;
  }
  return `${base}/set-password`;
}

module.exports = { setPasswordUrl, frontendBase };
