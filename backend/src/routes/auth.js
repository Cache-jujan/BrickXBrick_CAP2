const express = require("express");
const { query } = require("../lib/db");
const { supabaseAnon } = require("../lib/supabaseAnon");

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
 
    if (user.status !== "Active") {
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
      user: {
        id: user.userid,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      redirectPath: ROLE_DASHBOARDS[user.role] || "/dashboard", // sub-point 8
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
module.exports = router;