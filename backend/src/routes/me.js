// me.js — what any signed-in user may change about their own account.
const express = require("express");
const { query } = require("../lib/db");
const { supabaseAnon } = require("../lib/supabaseAnon");
const { supabaseAdmin } = require("../lib/supabaseAdmin");
const { USERNAME_RE, orgName } = require("../lib/displayName");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

const MIN_PASSWORD_LENGTH = 8;

// PATCH /api/me/profile — set your username. Everyone else then sees you as
// "username.role" (stored in Users.name, see lib/displayName.js).
// Body: { username }
// 200 { user: { id, name, username, email, role } }   400 invalid
router.patch("/profile", async (req, res, next) => {
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: "Username must be 3-30 letters, numbers or underscores." });
  }
  try {
    const result = await query(
      `UPDATE users SET username = $1, name = $2
       WHERE userid = $3
       RETURNING userid, name, username, email, role`,
      [username, orgName(username, req.user.role), req.user.id]
    );
    const u = result.rows[0];
    res.json({ user: { id: u.userid, name: u.name, username: u.username, email: u.email, role: u.role } });
  } catch (err) {
    next(err);
  }
});

// POST /api/me/change-password — change your password while signed in.
// Body: { currentPassword, newPassword }
// 204 changed   400 invalid   401 current password wrong
router.post("/change-password", async (req, res, next) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || !currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword and newPassword are required" });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: "New password must be different from the current one." });
  }
  try {
    const found = await query(`SELECT email, supabaseuserid FROM users WHERE userid = $1`, [req.user.id]);
    const { email, supabaseuserid } = found.rows[0];

    // Prove the current password first; a stolen token alone must not be enough.
    const { error: signInError } = await supabaseAnon.auth.signInWithPassword({ email, password: currentPassword });
    if (signInError) return res.status(401).json({ error: "Current password is incorrect." });

    const { error } = await supabaseAdmin.auth.admin.updateUserById(supabaseuserid, { password: newPassword });
    if (error) return res.status(400).json({ error: error.message });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
