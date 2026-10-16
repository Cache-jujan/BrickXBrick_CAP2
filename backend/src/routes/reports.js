// reports.js — F11 Financial Analytics and Reporting. General Manager only.
//
//   GET  /summary?projectIds=a,b&from=YYYY-MM-DD&to=YYYY-MM-DD
//   POST /pdf     { projectIds, from, to, chartImage }  ->  application/pdf
//
// The PDF route recomputes the summary itself; the only thing it takes from
// the browser is the chart picture.
//
// Thin on purpose: validation lives in lib/reportFilters.js, the SQL and the
// math in lib/reportSummary.js.

const crypto = require("crypto");
const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { validateReportFilters, validateChartImage } = require("../lib/reportFilters");
const { getReportSummary } = require("../lib/reportSummary");
const { canonicalizeReport } = require("../lib/blockchainService");
const { buildReportDocDefinition, renderPdf } = require("../lib/reportPdf");

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

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

router.post("/pdf", async (req, res, next) => {
  try {
    const filters = validateReportFilters(req.body);
    const chartImage = validateChartImage(req.body && req.body.chartImage);

    const summary = await getReportSummary(query, filters);
    if (summary.empty) {
      throw httpError(400, "No approved expenses in this period, so there is nothing to export.");
    }

    // The report is hashed from exactly what gets stored (see canonicalizeReport).
    const row = {
      reportid: crypto.randomUUID(),
      generatedby: req.user.id,
      projectids: filters.projectIds,
      periodfrom: filters.from,
      periodto: filters.to,
      generatedat: new Date(summary.generatedAt),
      totals: summary,
    };
    const payloadHash = canonicalizeReport(row);

    const pdf = await renderPdf(
      buildReportDocDefinition(summary, {
        reportId: row.reportid,
        payloadHash,
        anchorStatus: "Pending",
        chartImage,
        generatedByName: req.user.name,
      })
    );

    await query(
      `INSERT INTO report_events
         (reportid, generatedby, projectids, periodfrom, periodto, generatedat, totals, payloadhash)
       VALUES ($1, $2, $3::uuid[], $4::date, $5::date, $6, $7::jsonb, $8)`,
      [row.reportid, row.generatedby, row.projectids, row.periodfrom, row.periodto, row.generatedat, JSON.stringify(summary), payloadHash]
    );

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="brickxbrick-report-${filters.from}-to-${filters.to}.pdf"`,
      "X-Report-Id": row.reportid,
      "Access-Control-Expose-Headers": "X-Report-Id, Content-Disposition",
    });
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
