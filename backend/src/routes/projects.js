// projects.js — F2: Project Initialization
const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireAuth);

const BROADCAST_ROLES = ["General Manager", "Project Manager", "Site Manager", "Purchaser"];

const PROJECT_COLUMNS = `projectid, createdby, name, description, clientname, status, startdate, enddate, budget, projectmanagerid, sitemanagerid`;

// CREATE — GM only
router.post("/", requireRole("General Manager"), async (req, res) => {
  const {
    name,
    description,
    clientName,
    budget,
    startDate,
    endDate,
    projectManagerId,
    siteManagerId,
  } = req.body;

  if (!name || !clientName || budget === undefined || budget === null || !startDate) {
    return res.status(400).json({ error: "name, clientName, budget, and startDate are required" });
  }
  if (typeof budget !== "number" || budget < 0) {
    return res.status(400).json({ error: "budget must be a non-negative number" });
  }
  if (!projectManagerId) {
    return res.status(400).json({ error: "projectManagerId is required" });
  }

  try {
    // Validate PM reference — required, must exist, be Active, and hold the Project Manager role
    const pmCheck = await query("SELECT role, status FROM users WHERE userid = $1", [projectManagerId]);
    if (pmCheck.rowCount === 0) {
      return res.status(400).json({ error: "projectManagerId does not match an existing user" });
    }
    if (pmCheck.rows[0].role !== "Project Manager") {
      return res.status(400).json({ error: "projectManagerId must reference a user with role Project Manager" });
    }
    if (pmCheck.rows[0].status !== "Active") {
      return res.status(400).json({ error: "projectManagerId references a deactivated account" });
    }

    // Validate SM reference — optional at creation, may be assigned later
    if (siteManagerId) {
      const smCheck = await query("SELECT role, status FROM users WHERE userid = $1", [siteManagerId]);
      if (smCheck.rowCount === 0) {
        return res.status(400).json({ error: "siteManagerId does not match an existing user" });
      }
      if (smCheck.rows[0].role !== "Site Manager") {
        return res.status(400).json({ error: "siteManagerId must reference a user with role Site Manager" });
      }
      if (smCheck.rows[0].status !== "Active") {
        return res.status(400).json({ error: "siteManagerId references a deactivated account" });
      }
    }

    const result = await query(
      `INSERT INTO projects (createdby, name, description, clientname, status, startdate, enddate, budget, projectmanagerid, sitemanagerid)
       VALUES ($1, $2, $3, $4, 'Active', $5, $6, $7, $8, $9)
       RETURNING ${PROJECT_COLUMNS}`,
      [
        req.user.id,
        name,
        description || null,
        clientName,
        startDate,
        endDate || null,
        budget,
        projectManagerId,
        siteManagerId || null,
      ]
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