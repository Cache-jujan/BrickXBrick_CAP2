// Rate limits for the whole API, keyed by client IP.
//
//   general         every /api route: a backstop against floods, set well above
//                   what real users do (web polls every 30 s, the phone every
//                   20 s, a scan every 4 s while it runs).
//   login           POST /api/auth/login: only FAILED attempts count, so a
//                   whole site signing in on one office connection is fine,
//                   but password guessing across many accounts is stopped.
//                   The per-account lockout (lib/loginLockout.js) still applies.
//   changePassword  POST /api/me/change-password: same rule, failures only.
//
// The receipt scan limiter (20/min per signed-in user) lives in routes/receipts.js.
//
// The IP is only the real client's when Express is told how many proxies sit in
// front of it: server.js sets `trust proxy` to 1 for Cloud Run. Without that,
// every request would look like it came from Google's front end and all users
// would share one limit.
//
// Counters are kept in memory, per Cloud Run instance. With several instances
// the effective limit is per instance, not global.

const rateLimit = require("express-rate-limit");

const DEFAULTS = {
  general: { windowMs: 60 * 1000, limit: 1000 },
  login: { windowMs: 15 * 60 * 1000, limit: 20 },
  changePassword: { windowMs: 15 * 60 * 1000, limit: 10 },
};

function makeLimiter({ windowMs, limit }, message, { failuresOnly = false } = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: failuresOnly,
    message: { error: message },
  });
}

/** Build the three limiters. Pass smaller numbers in tests. */
function makeRateLimiters(overrides = {}) {
  const cfg = {
    general: { ...DEFAULTS.general, ...overrides.general },
    login: { ...DEFAULTS.login, ...overrides.login },
    changePassword: { ...DEFAULTS.changePassword, ...overrides.changePassword },
  };
  return {
    general: makeLimiter(cfg.general, "Too many requests. Wait a minute and try again."),
    login: makeLimiter(cfg.login, "Too many failed sign-in attempts. Wait a few minutes and try again.", { failuresOnly: true }),
    changePassword: makeLimiter(cfg.changePassword, "Too many failed password attempts. Wait a few minutes and try again.", { failuresOnly: true }),
  };
}

module.exports = { makeRateLimiters, DEFAULTS };