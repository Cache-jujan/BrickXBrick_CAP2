// adminUsers.js — F1 account actions. System Administrator only.
const express = require("express");
const { query } = require("../lib/db");
const { supabaseAdmin } = require("../lib/supabaseAdmin");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireAuth, requireRole("System Administrator"));

const VALID_ROLES = [
  "General Manager", "Project Manager", "Site Manager",
  "Purchaser", "System Administrator"
];
const MIN_PASSWORD_LENGTH = 8;

// CREATE
router.post("/", async (req, res) => {
  const { name, email, role, tempPassword } = req.body;
  if (!name || !email || !role) {
    return res.status(400).json({ error: "name, email, role are required" });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }
  try {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword || Math.random().toString(36).slice(2) + "Aa1!",
      email_confirm: true,
      user_metadata: { role }
    });
    if (error) return res.status(400).json({ error: error.message });
    const result = await query(
      `INSERT INTO Users (name, email, supabaseUserId, role, status)
       VALUES ($1, $2, $3, $4, 'Active')
       RETURNING userID, name, email, role, status`,
      [name, email, data.user.id, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
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
  const result = await query(
    `UPDATE Users SET role = COALESCE($1, role), status = COALESCE($2, status)
     WHERE userID = $3
     RETURNING userID, name, email, role, status`,
    [role || null, status || null, req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
  res.json(result.rows[0]);
});

// DEACTIVATE
router.post("/:id/deactivate", async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "You can't deactivate your own account" });
  }
  const result = await query(
    `UPDATE Users SET status = 'Inactive' WHERE userID = $1
     RETURNING userID, status`,
    [req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
  res.json(result.rows[0]);
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

// RESET PASSWORD — the only password-change path. Sets a new Supabase Auth
// password for the user and clears any login lockout so they can sign in
// straight away. Requests never echo the password back.
router.post("/:id/reset-password", async (req, res) => {
  const { newPassword } = req.body;
  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `newPassword must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  try {
    const lookup = await query(
      "SELECT supabaseuserid FROM Users WHERE userID = $1",
      [req.params.id]
    );
    if (lookup.rowCount === 0) return res.status(404).json({ error: "Not found" });

    const { error } = await supabaseAdmin.auth.admin.updateUserById(
      lookup.rows[0].supabaseuserid,
      { password: newPassword }
    );
    if (error) return res.status(400).json({ error: error.message });

    await query(
      "UPDATE Users SET lockoutUntil = NULL, failedloginattempts = 0 WHERE userID = $1",
      [req.params.id]
    );
    res.json({ userID: req.params.id, status: "password_reset" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
