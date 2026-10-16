// adminUsers.js — F1 account actions. System Administrator only.
const crypto = require("crypto");
const express = require("express");
const { query } = require("../lib/db");
const { supabaseAdmin } = require("../lib/supabaseAdmin");
const { supabaseAnon } = require("../lib/supabaseAnon");
const { setPasswordUrl } = require("../lib/passwordLink");
const { findOpenWork, hasOpenWork, describeOpenWork } = require("../lib/userOpenWork");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const GMAIL_RE = /^[a-z0-9.]{6,30}@gmail\.com$/;

const router = express.Router();
router.use(requireAuth, requireRole("System Administrator"));

const VALID_ROLES = [
  "General Manager", "Project Manager", "Site Manager",
  "Purchaser", "System Administrator"
];

// Refuse a role change or deactivation that would leave work stuck: a person
// who still manages an open project, has unfinished tasks or has material
// requests waiting on them must hand that work over first (lib/userOpenWork.js).
// Returns the 409 body, or null when the change is safe.
async function openWorkConflict(user) {
  const work = await findOpenWork(query, user.userid);
  if (!hasOpenWork(work)) return null;
  return { error: describeOpenWork(user.name, work), code: "user_has_open_work", openWork: work };
}

async function loadUser(id) {
  const r = await query(
    "SELECT userID, name, email, role, status, supabaseUserId FROM Users WHERE userID = $1",
    [id]
  );
  return r.rows[0] || null;
}

/** Create an active account and email an invite linking to the password setup page. */
router.post("/", async (req, res) => {
  const { name, role } = req.body;
  const email = (req.body.email || "").trim().toLowerCase();

  if (!name || !email || !role) {
    return res.status(400).json({ error: "name, email, role are required" });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }
  if (!GMAIL_RE.test(email)) {
    return res.status(400).json({ error: "A valid Gmail address (@gmail.com) is required" });
  }

  let authUserId;
  try {
    const dup = await query("SELECT 1 FROM Users WHERE email = $1", [email]);
    if (dup.rowCount > 0) {
      return res.status(400).json({ error: "That email already has an account" });
    }

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { role },
      redirectTo: setPasswordUrl(req),
    });
    if (error) {
      console.error("Invite failed:", error.status, error.message);
      return res.status(400).json({ error: error.message });
    }
    authUserId = data.user.id;

    const result = await query(
      `INSERT INTO Users (name, email, supabaseUserId, role, status)
       VALUES ($1, $2, $3, $4, 'Active')
       RETURNING userID, name, email, role, status`,
      [name, email, authUserId, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (authUserId) await supabaseAdmin.auth.admin.deleteUser(authUserId);
    res.status(500).json({ error: err.message });
  }
});

// LIST
router.get("/", async (req, res) => {
  const result = await query(
    `SELECT userID, name, email, role, status, lockoutUntil, createdAt
     FROM Users ORDER BY createdAt DESC`
  );
  res.json(result.rows);
});

// MODIFY
router.patch("/:id", async (req, res) => {
  const { role, status } = req.body;
  if (role && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }
  // An administrator must not be able to lock themselves out of the system.
  if (req.params.id === req.user.id && (role || status === "Inactive")) {
    return res.status(400).json({ error: "You can't change your own role or deactivate your own account" });
  }
  try {
    const user = await loadUser(req.params.id);
    if (!user) return res.status(404).json({ error: "Not found" });

    const roleChanges = role && role !== user.role;
    const deactivating = status === "Inactive" && user.status !== "Inactive";
    if (roleChanges || deactivating) {
      const conflict = await openWorkConflict(user);
      if (conflict) return res.status(409).json(conflict);
    }

    const result = await query(
      `UPDATE Users SET role = COALESCE($1, role), status = COALESCE($2, status)
       WHERE userID = $3
       RETURNING userID, name, email, role, status`,
      [role || null, status || null, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DEACTIVATE
router.post("/:id/deactivate", async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "You can't deactivate your own account" });
  }
  try {
    const user = await loadUser(req.params.id);
    if (!user) return res.status(404).json({ error: "Not found" });
    if (user.status !== "Inactive") {
      const conflict = await openWorkConflict(user);
      if (conflict) return res.status(409).json(conflict);
    }
    const result = await query(
      `UPDATE Users SET status = 'Inactive' WHERE userID = $1
       RETURNING userID, status`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UNLOCK (admin early-unlock)
router.post("/:id/unlock", async (req, res) => {
  const result = await query(
    `UPDATE Users SET lockoutUntil = NULL, failedloginattempts = 0 WHERE userID = $1
     RETURNING userID, lockoutUntil, failedloginattempts`,
    [req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
  res.json(result.rows[0]);
});

// SEND PASSWORD EMAIL — "Enforce change password upon login" (adviser, F1).
// The System Administrator never types or sees a password. This sends the
// user an email link to set their own password at /set-password:
//   - account never confirmed (invite not used yet) -> the invite is sent again
//   - active account                                  -> a password-recovery email
// After the email is sent, the old password is replaced with a random one
// nobody knows, so it stops working at once (useful when an account may be
// compromised), and any login lockout is cleared. A hacked admin account
// therefore can't take over other accounts: the new password is chosen from
// the user's own Gmail, and admins can't change a user's email.
/** Resend an invite or send recovery mail, retiring confirmed users' old passwords and clearing lockouts. */
router.post("/:id/send-password-email", async (req, res) => {
  try {
    const user = await loadUser(req.params.id);
    if (!user) return res.status(404).json({ error: "Not found" });
    if (user.status === "Inactive") {
      return res.status(409).json({ error: "This account is deactivated. Reactivate it before sending a password email." });
    }
    const redirectTo = setPasswordUrl(req);

    const { data: authData, error: lookupError } = await supabaseAdmin.auth.admin.getUserById(user.supabaseuserid);
    if (lookupError || !authData?.user) {
      return res.status(400).json({ error: lookupError?.message || "This account has no sign-in record" });
    }
    const confirmed = Boolean(authData.user.email_confirmed_at || authData.user.confirmed_at);

    let channel;
    if (confirmed) {
      const { error } = await supabaseAnon.auth.resetPasswordForEmail(user.email, { redirectTo });
      if (error) return res.status(400).json({ error: error.message });
      channel = "recovery";
    } else {
      const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(user.email, {
        data: { role: user.role },
        redirectTo,
      });
      if (error) return res.status(400).json({ error: error.message });
      channel = "invite";
    }

    if (confirmed) {
      const throwaway = crypto.randomBytes(32).toString("base64url");
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user.supabaseuserid, { password: throwaway });
      if (error) console.error(`Could not retire the old password for ${user.userid}:`, error.message);
    }

    await query(
      "UPDATE Users SET lockoutUntil = NULL, failedloginattempts = 0 WHERE userID = $1",
      [req.params.id]
    );
    res.json({ userID: user.userid, status: "password_email_sent", channel });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
