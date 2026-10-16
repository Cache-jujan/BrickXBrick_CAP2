// F1: send every Supabase email link (new-account invite, password recovery)
// to the Set your password page, whatever page Supabase opened.
//
// Supabase puts the sign-in token in the URL hash:
//   /#access_token=...&type=invite      (new account)
//   /#access_token=...&type=recovery    (Forgot password / Send password email)
//   /#error=access_denied&error_code=otp_expired...   (old or used link)
// If the link's redirect URL is not on the Supabase allow list, or the backend
// has no FRONTEND_URL, Supabase opens the Site URL (the app root) instead of
// /set-password. The root sends guests to /login and the token is lost, so a
// new user lands on Sign in with no password. This runs before the app and
// the Supabase client start, and moves the browser to /set-password with the
// hash kept, so the page can still read the token.
//
// It also remembers whether the link was an invite, so the page can greet a
// new user ("Create your password") instead of a password reset.

const LINK_TYPES = ["invite", "recovery", "signup", "magiclink"];
export const LINK_TYPE_KEY = "bxb_auth_link_type";

/**
 * Return the destination and link type for a Supabase token or error hash, or null for unrelated hashes.
 * A null destination path means the browser is already on /set-password.
 */
export function authLinkTarget(pathname, hash) {
  if (!hash || hash.length < 2) return null;
  const params = new URLSearchParams(hash.slice(1));
  const type = params.get("type");
  const isTokenLink = params.has("access_token") && LINK_TYPES.includes(type);
  const isBrokenLink = params.has("error_code") || params.has("error_description");
  if (!isTokenLink && !isBrokenLink) return null;
  return { path: pathname === "/set-password" ? null : "/set-password", type: isTokenLink ? type : null };
}

/** Remember the auth link type when storage is available and move to /set-password, preserving the hash. */
export function redirectAuthLink() {
  if (typeof window === "undefined") return;
  const target = authLinkTarget(window.location.pathname, window.location.hash);
  if (!target) return;
  try {
    if (target.type) sessionStorage.setItem(LINK_TYPE_KEY, target.type);
    else sessionStorage.removeItem(LINK_TYPE_KEY);
  } catch {
    // Private mode or blocked storage: the page falls back to its usual wording.
  }
  if (target.path) window.history.replaceState(null, "", target.path + window.location.hash);
}

redirectAuthLink();
