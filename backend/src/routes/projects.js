// projects.js — F2: Project Initialization
const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireAuth);

const BROADCAST_ROLES = ["General Manager", "Project Manager", "Site Manager", "Purchaser"];

const PROJECT_COLUMNS = `projectid, createdby, name, description, clientname, status, startdate, enddate, budget`;

// CREATE — GM only
router.post("/", requireRole("General Manager"), async (req, res) => {
  const { name, description, clientName, budget, startDate, endDate } = req.body;

  if (!name || !clientName || budget === undefined || budget === null || !startDate) {
    return res.status(400).json({ error: "name, clientName, budget, and startDate are required" });
  }
  if (typeof budget !== "number" || budget < 0) {
    return res.status(400).json({ error: "budget must be a non-negative number" });
  }

  try {
    const result = await query(
      `INSERT INTO projects (createdby, name, description, clientname, status, startdate, enddate, budget)
       VALUES ($1, $2, $3, $4, 'Active', $5, $6, $7)
       RETURNING ${PROJECT_COLUMNS}`,
      [req.user.id, name, description || null, clientName, startDate, endDate || null, budget]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LIST — broadcast to GM/PM/SM/Purchaser; optional ?status=Active filter
router.get("/", requireRole(...BROADCAST_ROLES), async (req, res) => {
  const { status } = req.query;
  try {
    const result = status
      ? await query(
          `SELECT ${PROJECT_COLUMNS} FROM projects WHERE status = $1 ORDER BY startdate DESC`,
          [status]
        )
      : await query(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY startdate DESC`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SINGLE
router.get("/:id", requireRole(...BROADCAST_ROLES), async (req, res) => {
  try {
    const result = await query(
      `SELECT ${PROJECT_COLUMNS} FROM projects WHERE projectid = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;