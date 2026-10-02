// allocations.js — F8 split-receipt allocation.
//
// Being rebuilt for the no-bookkeeper design: the server splits each receipt
// line across open Material Requests (see lib/allocationPlan.js).
//   Task 4: GET /open-requests and POST /preview
//   Task 5: POST / (one transaction, then screening after COMMIT)
// Until Task 5 lands, POST / answers 501 instead of running the old
// per-project code against the new request body.
//
// Actors: Purchaser (primary); Project Manager and General Manager are the
// backup actors named in UC-08-01.

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireAuth);

const ALLOCATION_ROLES = ["Purchaser", "Project Manager", "General Manager"];

router.post("/", requireRole(...ALLOCATION_ROLES), (req, res) => {
  res.status(501).json({ error: "Split allocation is being rebuilt (F8 Task 5). Use POST /api/expenses for single-request receipts." });
});

module.exports = router;
