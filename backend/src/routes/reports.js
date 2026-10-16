// reports.js — F11 Financial Analytics and Reporting. General Manager only.
//
//   GET  /summary?projectIds=a,b&from=YYYY-MM-DD&to=YYYY-MM-DD
//   POST /pdf     { projectIds, from, to, chartImage }  ->  application/pdf
//   POST /:id/anchor   retry securing a Pending report on the blockchain
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
const { anchorReport } = require("../lib/reportAnchor");
const { buildReportDocDefinition, renderPdf } = require("../lib/reportPdf");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    await query(
      `INSERT INTO report_events
         (reportid, generatedby, projectids, periodfrom, periodto, generatedat, totals, payloadhash)
       VALUES ($1, $2, $3::uuid[], $4::date, $5::date, $6, $7::jsonb, $8)`,
      [row.reportid, row.generatedby, row.projectids, row.periodfrom, row.periodto, row.generatedat, JSON.stringify(summary), payloadHash]
    );

    // Try to secure the hash on the chain. A chain problem never blocks the
    // PDF: the report stays Pending and POST /:id/anchor can retry it.
    const anchor = await anchorReport(row.reportid, req.user);

    const pdf = await renderPdf(
      buildReportDocDefinition(summary, {
        reportId: row.reportid,
        payloadHash,
        anchor,
        chartImage,
        generatedByName: req.user.name,
      })
    );

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="brickxbrick-report-${filters.from}-to-${filters.to}.pdf"`,
      "X-Report-Id": row.reportid,
      "X-Report-Anchor-Status": anchor.status,
      "Access-Control-Expose-Headers": "X-Report-Id, X-Report-Anchor-Status, Content-Disposition",
    });
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

// POST /:id/anchor — retry a Pending report. 200 once Confirmed, 202 while the
// chain is still unavailable (same convention as expense approval).
router.post("/:id/anchor", async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) throw httpError(400, "Invalid report id");
    const anchor = await anchorReport(req.params.id.toLowerCase(), req.user);
    const body = { reportId: req.params.id.toLowerCase(), anchorStatus: anchor.status, ...anchor };
    delete body.status;
    if (anchor.status === "Confirmed") return res.json(body);
    res.status(202).json({ ...body, warning: "Blockchain unavailable (fewer than 2 of 3 nodes). The report stays Pending; try again later." });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
