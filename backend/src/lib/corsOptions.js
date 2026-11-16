// CORS: which websites may call this API from a browser.
//
// Allowed: the web app (FRONTEND_URL), any extra addresses listed in
// CORS_ORIGINS (comma-separated, e.g. a Vercel preview), and localhost /
// 127.0.0.1 on any port when NODE_ENV is not "production" (Dockerfile sets it).
//
// A request with no Origin header is always allowed: the mobile app, curl,
// server-to-server calls and Cloud Run health checks never send one, and CORS
// is a browser rule anyway. A disallowed origin just gets no CORS headers, so
// the browser refuses to hand the response to the page; the API does not
// return an error for it.

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** "https://app.example.com/some/path/" -> "https://app.example.com", or null if not a URL. */
function toOrigin(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const { origin } = new URL(raw);
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

/** The set of exact origins allowed from the environment. */
function allowedOrigins(env = process.env) {
  const listed = String(env.CORS_ORIGINS ?? "").split(",");
  return new Set([env.FRONTEND_URL, ...listed].map(toOrigin).filter(Boolean));
}

/** Decide one request's Origin header. */
function isAllowedOrigin(origin, allowed, env = process.env) {
  if (!origin) return true;
  if (allowed.has(origin)) return true;
  return env.NODE_ENV !== "production" && LOCAL_ORIGIN.test(origin);
}

/** Options for the cors() middleware. Logs each refused origin once, to make a wrong FRONTEND_URL easy to spot. */
function corsOptions(env = process.env, log = console.warn) {
  const allowed = allowedOrigins(env);
  const warned = new Set();
  return {
    origin(origin, callback) {
      const ok = isAllowedOrigin(origin, allowed, env);
      if (!ok && !warned.has(origin)) {
        warned.add(origin);
        log(`CORS: blocked origin ${origin}. Add it to FRONTEND_URL or CORS_ORIGINS if it should be allowed.`);
      }
      callback(null, ok);
    },
  };
}

module.exports = { corsOptions, allowedOrigins, isAllowedOrigin, toOrigin };