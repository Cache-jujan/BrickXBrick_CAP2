// loginLockout.js — the failed-password limit, in one place.
//
// The login route and "change my password" both check a password against
// Supabase, so both count wrong guesses on the same counter
// (users.failedloginattempts) and lock the account the same way. requireAuth
// then refuses every API call from a locked account (423).
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

module.exports = { MAX_ATTEMPTS, LOCKOUT_MINUTES };
