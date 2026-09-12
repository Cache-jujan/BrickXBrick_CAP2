// tasks.js — F3: task listing only. Progress submission is F5, separate module.
const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireAuth);

// GET /assigned — tasks assigned to the calling Site Manager.
router.get("/assigned", requireRole("Site Manager"), async (req, res, next) => {
    try {
        const result = await query(
            "SELECT * FROM tasks WHERE assignedTo = $1 ORDER BY dueDate ASC",
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

module.exports = router;