// adminUsers.js — the five F1 account actions. System Administrator only.
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
    `UPDATE Users SET lockoutUntil = NULL WHERE userID = $1
     RETURNING userID, lockoutUntil`,
    [req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
  res.json(result.rows[0]);
});

module.exports = router;
