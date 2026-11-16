// loginLockout.js: the failed-password limit, in one place.
//
// The login route and "change my password" both check a password against
// Supabase, so both count wrong guesses on the same counter
// (users.failedloginattempts) and lock the account the same way. requireAuth
// then refuses every API call from a locked account (423).
// After MAX_ATTEMPTS wrong passwords the account is locked for LOCKOUT_MINUTES.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Counts one wrong password in a single UPDATE. Reading the counter, adding 1
// in JS and writing it back lets parallel wrong guesses all start from the same
// number, so a burst of 10 only counted as 1. An account that is already locked
// is skipped, so late requests in the burst can't add to the counter or clear
// the lock. The times come from JS, the same way lockoutuntil was always written.
// Returns { locked, attemptsLeft }.
async function recordFailedAttempt(runQuery, userId, now = new Date()) {
  const lockUntil = new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000);
  const result = await runQuery(
    `UPDATE users
        SET failedloginattempts = CASE WHEN failedloginattempts + 1 >= $2::int THEN 0 ELSE failedloginattempts + 1 END,
            lockoutuntil        = CASE WHEN failedloginattempts + 1 >= $2::int THEN $3 ELSE lockoutuntil END
      WHERE userid = $1
        AND (lockoutuntil IS NULL OR lockoutuntil <= $4)
      RETURNING failedloginattempts,
                (lockoutuntil IS NOT NULL AND lockoutuntil > $4) AS locked`,
    [userId, MAX_ATTEMPTS, lockUntil, now]
  );

  // No row updated means an earlier request already locked the account.
  if (result.rowCount === 0) return { locked: true, attemptsLeft: 0 };

  const row = result.rows[0];
  const locked = row.locked === true;
  return {
    locked,
    attemptsLeft: locked ? 0 : Math.max(0, MAX_ATTEMPTS - Number(row.failedloginattempts)),
  };
}

module.exports = { MAX_ATTEMPTS, LOCKOUT_MINUTES, recordFailedAttempt };
