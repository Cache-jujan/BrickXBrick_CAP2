const express = require("express");
const { query } = require("../lib/db");
const { supabaseAnon } = require("../lib/supabaseAnon");
const { refreshWithSupabase } = require("../lib/supabaseRefresh");
const { termsFields } = require("./legal");

const router = express.Router();

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;


// Tentative need adjustment if na implement na ang frontend
const ROLE_DASHBOARDS = {
 "General Manager": "/dashboard/gm",
  "Project Manager": "/dashboard/pm",
  "Site Manager": "/dashboard/sm",
  "Purchaser": "/dashboard/purchaser",
  "System Administrator": "/dashboard/admin",
};

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }
 
  try {
    const userResult = await query(
      `SELECT userid, name, email, role, status, lockoutuntil, failedloginattempts
       FROM users WHERE email = $1`,
      [email]
    );
 
    // Same generic message whether the email doesn't exist or the password
    // is wrong — don't leak which one it was.
    const genericFail = () =>
      res.status(401).json({ error: "Invalid email or password" });
 
    if (userResult.rowCount === 0) return genericFail();
    const user = userResult.rows[0];
 
    // A deactivated account only hears so after proving it knows the password,
    // so this route cannot be used to find out which emails are deactivated.
    if (user.status !== "Active") {
      const { error: inactiveError } = await supabaseAnon.auth.signInWithPassword({ email, password });
      if (inactiveError) return genericFail();
      return res.status(403).json({ error: "This account has been deactivated. Contact your System Administrator." });
    }
 
    if (user.lockoutuntil && new Date(user.lockoutuntil) > new Date()) {
      return res.status(423).json({
        error: "Account locked due to repeated failed logins.",
        lockoutUntil: user.lockoutuntil,
      });
    }
 
    const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
 
    if (error) {
      const attempts = user.failedloginattempts + 1;
      const lockingNow = attempts >= MAX_ATTEMPTS;
 
      await query(
        `UPDATE users
         SET failedloginattempts = $1,
             lockoutuntil = $2
         WHERE userid = $3`,
        [
          lockingNow ? 0 : attempts, // reset counter once the lock is set
          lockingNow ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null,
          user.userid,
        ]
      );
 
      if (lockingNow) {
        return res.status(423).json({
          error: `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`,
        });
      }
      return genericFail();
    }
 
    // Success — clear any prior failed-attempt state.
    await query(
      `UPDATE users SET failedloginattempts = 0, lockoutuntil = NULL WHERE userID = $1`,
      [user.userid]
    );
 
    return res.json({
      token: data.session.access_token,   // sub-point 6: JWT session
      // The mobile app keeps itself signed in with these (POST /refresh below).
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at, // unix seconds
      user: {
        id: user.userid,
        name: user.name,
        email: user.email,
        role: user.role,
        // false until the current Terms of Use / Privacy Notice is accepted
        ...(await termsFields(user.userid)),
      },
      redirectPath: ROLE_DASHBOARDS[user.role] || "/dashboard", // sub-point 8
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /refresh — swap a refresh token for a new access token, so the mobile
// app stays signed in (and can send what it queued offline) without asking for
// the password again.
// Body: { refreshToken }
// 200 { token, refreshToken, expiresAt }  the old refresh token is now used up:
//                                          the app must keep the new one
// 400 missing   401 not accepted (expired, used, revoked), sign in again
// 403 deactivated   423 locked   503 Supabase unavailable, try again later
router.post("/refresh", async (req, res) => {
  const refreshToken = req.body && req.body.refreshToken;
  if (typeof refreshToken !== "string" || refreshToken.trim() === "") {
    return res.status(400).json({ error: "refreshToken is required" });
  }

  let result;
  try {
    result = await refreshWithSupabase(refreshToken);
  } catch (err) {
    console.error("Token refresh could not reach Supabase:", err.message);
    return res.status(503).json({ error: "Could not refresh the sign-in right now. Try again shortly." });
  }
  if (!result.ok) {
    return res.status(401).json({ error: "Sign-in expired. Please sign in again." });
  }

  try {
    const found = await query(
      `SELECT userid, status, lockoutuntil FROM users WHERE supabaseuserid = $1`,
      [result.session.supabaseUserId]
    );
    if (found.rowCount === 0) {
      return res.status(401).json({ error: "Sign-in expired. Please sign in again." });
    }
    const user = found.rows[0];
    // Same checks as requireAuth and login: a deactivated or locked account
    // must not keep itself alive with an old refresh token.
    if (user.status !== "Active") {
      return res.status(403).json({ error: "This account has been deactivated. Contact your System Administrator." });
    }
    if (user.lockoutuntil && new Date(user.lockoutuntil) > new Date()) {
      return res.status(423).json({ error: "Account locked due to repeated failed logins.", lockoutUntil: user.lockoutuntil });
    }
    return res.json({
      token: result.session.accessToken,
      refreshToken: result.session.refreshToken,
      expiresAt: result.session.expiresAt,
    });
  } catch (err) {
    console.error("DB error in token refresh:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;