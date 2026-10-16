import { useRef, useState } from "react";
import { anchorReport, downloadReportPdf, getReportSummary, saveBlob } from "../../api/reportsApi";
import { extractErrorMessage } from "../../api/client";
import { useProjects } from "../../utils/useProjects";
import { defaultReportRange, validateReportFilters } from "../../utils/reportFilters";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { BirTable } from "../../components/reports/BirTable";
import { BudgetChart } from "../../components/reports/BudgetChart";
import { ReportFilters } from "../../components/reports/ReportFilters";
import { SummaryCards } from "../../components/reports/SummaryCards";
import "./ReportsPage.css";

const STAMP = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// FUNCTION F11 — Financial Analytics and Reporting (General Manager only).
// Generate asks GET /api/reports/summary; the server does all the maths, this
// page only shows it. The cards describe the filters that were GENERATED, not
// whatever is currently typed in the form, so a half-edited date never makes
// the numbers look like they belong to a different period.
export function ReportsPage() {
  const { projects, loading: projectsLoading, error: projectsError } = useProjects();
  const [filters, setFilters] = useState(() => ({ projectIds: [], ...defaultReportRange() }));
  const [fieldErrors, setFieldErrors] = useState({});
  const [summary, setSummary] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // What the cards and chart on screen were generated from. Export uses THESE,
  // not whatever is currently typed in the form.
  const [generated, setGenerated] = useState(null);
  const chartRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  // After an export: { reportId, anchorStatus: "Confirmed" | "Pending", retrying, retryMessage }
  const [exportResult, setExportResult] = useState(null);
  const [exportError, setExportError] = useState("");

  async function generate() {
    const errors = validateReportFilters(filters);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    setError("");
    setExportResult(null);
    setExportError("");
    try {
      setSummary(await getReportSummary(filters));
      setGenerated({ ...filters });
    } catch (err) {
      setSummary(null);
      setGenerated(null);
      setError(extractErrorMessage(err, "Couldn't generate the report."));
    } finally {
      setSubmitting(false);
    }
  }

  const warnings = summary?.warnings;

  async function exportPdf() {
    const chartImage = chartRef.current?.getImage();
    if (!generated || !chartImage) return;
    setExporting(true);
    setExportError("");
    setExportResult(null);
    try {
      const result = await downloadReportPdf({ ...generated, chartImage });
      saveBlob(result.blob, result.filename);
      setExportResult({ reportId: result.reportId, anchorStatus: result.anchorStatus, retrying: false, retryMessage: "" });
    } catch (err) {
      setExportError(extractErrorMessage(err, "Couldn't export the report."));
    } finally {
      setExporting(false);
    }
  }

  // The PDF already downloaded with "Pending" in its footer; this only secures
  // the stored report on the blockchain. It never makes a new PDF.
  async function retryAnchor() {
    setExportResult((r) => ({ ...r, retrying: true, retryMessage: "" }));
    try {
      const result = await anchorReport(exportResult.reportId);
      setExportResult((r) => ({
        ...r,
        retrying: false,
        anchorStatus: result.anchorStatus,
        retryMessage: result.anchorStatus === "Confirmed" ? "" : "The blockchain is still unavailable. Please try again in a few minutes.",
      }));
    } catch (err) {
      setExportResult((r) => ({ ...r, retrying: false, retryMessage: extractErrorMessage(err, "Couldn't reach the blockchain. Please try again.") }));
    }
  }

  return (
    <div className="reports-page">
      <div className="page-header">
        <div className="page-header-text">
          <h1>Reports</h1>
          <p className="page-header-sub">Budget against spend for up to five projects, over a date range.</p>
        </div>
      </div>

      <ReportFilters
        projects={projects}
        projectsLoading={projectsLoading}
        projectsError={projectsError}
        value={filters}
        errors={fieldErrors}
        submitting={submitting}
        onChange={setFilters}
        onSubmit={generate}
      />

      {error && <Banner tone="error" title={error} />}

      {summary && summary.empty && (
        <Banner tone="empty" title="No approved expenses in this period">
          Nothing was approved between {summary.period.from} and {summary.period.to} for the projects you chose. Try a wider
          date range or other projects.
        </Banner>
      )}

      {summary && !summary.empty && (
        <>
          <p className="reports-stamp">
            Figures as of {STAMP.format(new Date(summary.generatedAt))} (Manila time) · {summary.period.from} to {summary.period.to}
          </p>

          {(warnings.pendingExpenses > 0 || warnings.fraudFlaggedExpenses > 0) && (
            <Banner tone="warning" title="These figures may change">
              {warnings.pendingExpenses > 0 && (
                <p>
                  {plural(warnings.pendingExpenses, "expense is", "expenses are")} still waiting for approval in this period and{" "}
                  {warnings.pendingExpenses === 1 ? "is" : "are"} not counted.
                </p>
              )}
              {warnings.fraudFlaggedExpenses > 0 && (
                <p>
                  {plural(warnings.fraudFlaggedExpenses, "expense carries", "expenses carry")} an unresolved fraud flag.
                </p>
              )}
            </Banner>
          )}

          <SummaryCards totals={summary.totals} periodTo={summary.period.to} />

          <div className="reports-grid">
            <Card>
              <h2 className="reports-section-title">Budget against spend</h2>
              <BudgetChart ref={chartRef} projects={summary.projects} />
            </Card>
            <Card>
              <BirTable projects={summary.projects} totals={summary.totals} />
            </Card>
          </div>

          <div className="reports-export">
            <Button onClick={exportPdf} disabled={exporting}>
              {exporting ? "Preparing PDF…" : "Export PDF"}
            </Button>
            <span className="reports-export-note">
              The PDF is rebuilt from the database and saved as a record, so its figures always match the system.
            </span>
          </div>

          {exportError && <Banner tone="error" title={exportError} />}

          {exportResult && exportResult.anchorStatus === "Confirmed" && (
            <Banner tone="success" title="Report downloaded and secured">
              A tamper-proof copy of this report's fingerprint is now on the blockchain.
            </Banner>
          )}

          {exportResult && exportResult.anchorStatus !== "Confirmed" && (
            <Banner
              tone="warning"
              title="Report downloaded, but not yet secured on the blockchain"
              action={
                <Button variant="secondary" onClick={retryAnchor} disabled={exportResult.retrying}>
                  {exportResult.retrying ? "Trying…" : "Try again"}
                </Button>
              }
            >
              <p>
                The blockchain network was unavailable, so this report is saved as Pending. Your PDF is fine and says
                "Pending" in its footer. Use Try again once the network is back; no new PDF is needed.
              </p>
              {exportResult.retryMessage && <p>{exportResult.retryMessage}</p>}
            </Banner>
          )}
        </>
      )}
    </div>
  );
}
