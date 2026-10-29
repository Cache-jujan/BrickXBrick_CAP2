// me.js — what any signed-in user may change about their own account.
const express = require("express");
const multer = require("multer");
const { query } = require("../lib/db");
const { supabaseAnon } = require("../lib/supabaseAnon");
const { supabaseAdmin } = require("../lib/supabaseAdmin");
const { USERNAME_RE, orgName } = require("../lib/displayName");
const { requireAuth } = require("../middleware/auth");
const { uploadBuffer } = require("../lib/r2");
const { AVATAR_MAX_BYTES, sniffImageType } = require("../lib/avatar");
const { brokenPasswordRules, PASSWORD_RULES_MESSAGE } = require("../lib/passwordRules");
const { MAX_ATTEMPTS, LOCKOUT_MINUTES } = require("../lib/loginLockout");

const router = express.Router();
router.use(requireAuth);

const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } });

function receiveAvatar(req, res, next) {
  avatarUpload.single("photo")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const message = err.code === "LIMIT_FILE_SIZE" ? "The picture must be 2 MB or smaller." : err.message;
      return res.status(400).json({ error: message });
    }
    return next(err);
  });
}

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

// POST /api/me/change-password — change your password while signed in (like
// Facebook: the current password plus the new one).
// A wrong current password counts on the same counter as a wrong password at
// login: after MAX_ATTEMPTS the account is locked for LOCKOUT_MINUTES. Without
// that, someone holding a stolen session could guess the current password
// without limit.
// Body: { currentPassword, newPassword }
// 204 changed   400 invalid   401 current password wrong   423 locked
router.post("/change-password", async (req, res, next) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || !currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword and newPassword are required" });
  }
  if (brokenPasswordRules(newPassword).length > 0) {
    return res.status(400).json({ error: PASSWORD_RULES_MESSAGE });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: "New password must be different from the current one." });
  }
  try {
    const found = await query(
      `SELECT email, supabaseuserid, failedloginattempts FROM users WHERE userid = $1`,
      [req.user.id]
    );
    const { email, supabaseuserid, failedloginattempts } = found.rows[0];

    // Prove the current password first; a stolen token alone must not be enough.
    const { error: signInError } = await supabaseAnon.auth.signInWithPassword({ email, password: currentPassword });
    if (signInError) {
      const attempts = (failedloginattempts || 0) + 1;
      const locking = attempts >= MAX_ATTEMPTS;
      await query(
        `UPDATE users SET failedloginattempts = $1, lockoutuntil = $2 WHERE userid = $3`,
        [locking ? 0 : attempts, locking ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null, req.user.id]
      );
      if (locking) {
        return res.status(423).json({
          error: `Too many wrong passwords. Your account is locked for ${LOCKOUT_MINUTES} minutes.`,
        });
      }
      const left = MAX_ATTEMPTS - attempts;
      return res.status(401).json({
        error: `Current password is incorrect. ${left} ${left === 1 ? "attempt" : "attempts"} left before your account is locked.`,
      });
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(supabaseuserid, { password: newPassword });
    if (error) return res.status(400).json({ error: error.message });

    // The right password proves who is typing: clear any earlier wrong guesses.
    await query(`UPDATE users SET failedloginattempts = 0, lockoutuntil = NULL WHERE userid = $1`, [req.user.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /api/me/avatar — set your profile picture. multipart/form-data, field "photo"
// (a JPEG or PNG, up to 2 MB).
// 200 { avatarUrl }   400 missing / wrong type / too large
router.post("/avatar", receiveAvatar, async (req, res, next) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "Choose a picture to upload." });
  const type = sniffImageType(file.buffer);
  if (!type) return res.status(400).json({ error: "The picture must be a JPEG or PNG image." });
  try {
    const avatarUrl = await uploadBuffer(file.buffer, { contentType: type, keyPrefix: `avatars/${req.user.id}` });
    await query(`UPDATE users SET avatarurl = $1 WHERE userid = $2`, [avatarUrl, req.user.id]);
    res.json({ avatarUrl });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/me/avatar — go back to the initial-letter circle.
// 200 { avatarUrl: null }
router.delete("/avatar", async (req, res, next) => {
  try {
    await query(`UPDATE users SET avatarurl = NULL WHERE userid = $1`, [req.user.id]);
    res.json({ avatarUrl: null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
