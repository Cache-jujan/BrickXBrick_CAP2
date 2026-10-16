// reports.js — F11 Financial Analytics and Reporting. General Manager only.
//
//   GET /summary?projectIds=a,b&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Thin on purpose: validation lives in lib/reportFilters.js, the SQL and the
// math in lib/reportSummary.js.

const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { validateReportFilters } = require("../lib/reportFilters");
const { getReportSummary } = require("../lib/reportSummary");

const router = express.Router();
router.use(requireAuth);
router.use(requireRole("General Manager"));

router.get("/summary", async (req, res, next) => {
  try {
    const filters = validateReportFilters(req.query);
    res.json(await getReportSummary(query, filters));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
