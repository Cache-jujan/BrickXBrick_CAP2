import { useEffect, useRef, useState } from "react";
import { anchorReport, downloadReportPdf, getReportSummary, saveBlob } from "../../api/reportsApi";
import { extractErrorMessage } from "../../api/client";
import { useProjects } from "../../utils/useProjects";
import { MAX_PROJECTS, defaultReportRange, explainEmpty, spanOfProjects, validateReportFilters } from "../../utils/reportFilters";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { BudgetChart } from "../../components/reports/BudgetChart";
import { BudgetStands, ProjectHero } from "../../components/reports/ProjectReport";
import { ProjectsTable } from "../../components/reports/ProjectsTable";
import { SpendShare } from "../../components/reports/SpendShare";
import { VarianceChart } from "../../components/reports/VarianceChart";
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
  // Until the GM types a date by hand, choosing projects fills the range from
  // their start and finish dates. Typing a date stops that.
  const datesTouched = useRef(false);
  const problemsRef = useRef(null);
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

  const selectedProjects = projects.filter((p) => filters.projectIds.includes(p.projectid));

  function toggleProject(projectId) {
    const ids = filters.projectIds.includes(projectId)
      ? filters.projectIds.filter((id) => id !== projectId)
      : [...filters.projectIds, projectId];
    let next = { ...filters, projectIds: ids };
    if (!datesTouched.current) {
      const span = spanOfProjects(projects.filter((p) => ids.includes(p.projectid)));
      if (span) next = { ...next, from: span.from, to: span.to };
    }
    setFieldErrors({});
    setFilters(next);
  }

  // The report is about projects that are running, so one click picks them all
  // (at most MAX_PROJECTS, the report's limit). Dates follow like a manual pick.
  const activeProjects = projects.filter((p) => p.status === "Active");
  function selectActive() {
    const ids = activeProjects.slice(0, MAX_PROJECTS).map((p) => p.projectid);
    let next = { ...filters, projectIds: ids };
    if (!datesTouched.current) {
      const span = spanOfProjects(projects.filter((p) => ids.includes(p.projectid)));
      if (span) next = { ...next, from: span.from, to: span.to };
    }
    setFieldErrors({});
    setFilters(next);
  }

  // Picking a start after the end moves the end along (and the other way
  // round), so a date in another year can be chosen without fiddling.
  function changeDate(field, day) {
    datesTouched.current = true;
    const next = { ...filters, [field]: day };
    if (field === "from" && day && next.to && day > next.to) next.to = day;
    if (field === "to" && day && next.from && day < next.from) next.from = day;
    setFieldErrors({});
    setFilters(next);
  }

  // One-click period (This month, Last 3 months, ...).
  function chooseRange(from, to) {
    datesTouched.current = true;
    setFieldErrors({});
    setFilters({ ...filters, from, to });
  }

  function clearProjects() {
    setFieldErrors({});
    setFilters({ ...filters, projectIds: [] });
  }

  function useProjectDates() {
    const span = spanOfProjects(selectedProjects);
    if (!span) return;
    datesTouched.current = false;
    setFieldErrors({});
    setFilters({ ...filters, from: span.from, to: span.to });
  }

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
  const singleProject = summary?.projects?.length === 1;
  const problems = [...Object.values(fieldErrors), ...(error ? [error] : [])];

  // Bring the problem into view: a small red line under a field is easy to miss.
  useEffect(() => {
    if (problems.length > 0) problemsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [problems.length, error, fieldErrors]);

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
        onToggleProject={toggleProject}
        onDateChange={changeDate}
        onRangeChange={chooseRange}
        onClearProjects={clearProjects}
        onSelectActive={selectActive}
        activeCount={activeProjects.length}
        onUseProjectDates={useProjectDates}
        onSubmit={generate}
      />

      {!summary && !submitting && problems.length === 0 && (
        <div className="reports-placeholder">
          <p className="reports-placeholder-title">Your report will appear here</p>
          <p>Choose one or more projects and a period, then select Generate report. You will see the budget against spend, a table of every project and the tax-deductible spending, and you can export it as a PDF.</p>
        </div>
      )}

      {problems.length > 0 && (
        <div ref={problemsRef}>
          <Banner tone="error" title="The report was not generated">
            <ul className="reports-problems">
              {problems.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </Banner>
        </div>
      )}

      {summary && summary.empty && (
        <Banner
          tone="empty"
          title="No approved expenses in this period"
          action={
            selectedProjects.length > 0 && (
              <Button variant="secondary" onClick={useProjectDates}>
                Use project dates
              </Button>
            )
          }
        >
          <ul className="reports-problems">
            {explainEmpty({
              selected: selectedProjects,
              from: summary.period.from,
              to: summary.period.to,
              pendingExpenses: summary.warnings.pendingExpenses,
            }).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </Banner>
      )}

      {summary && !summary.empty && (
        <section className="reports-results" aria-label="Report results">
          <div className="reports-results-head">
            <div>
              <h2 className="reports-results-title">{singleProject ? "Project report" : "Report results"}</h2>
              <p className="reports-stamp">
                {summary.period.from} to {summary.period.to} · figures as of {STAMP.format(new Date(summary.generatedAt))} (Manila time)
              </p>
            </div>
            <div className="reports-export">
              <Button onClick={exportPdf} disabled={exporting}>
                {exporting ? "Preparing PDF…" : "Export PDF"}
              </Button>
              <span className="reports-export-note">Saved as a record; figures always match the system.</span>
            </div>
          </div>

          {(warnings.pendingExpenses > 0 || warnings.fraudFlaggedExpenses > 0) && (
            <Banner tone="warning" title="These figures may change">
              <p>
                {[
                  warnings.pendingExpenses > 0 && `${plural(warnings.pendingExpenses, "expense is", "expenses are")} waiting for approval and not counted`,
                  warnings.fraudFlaggedExpenses > 0 && `${plural(warnings.fraudFlaggedExpenses, "expense carries", "expenses carry")} an unresolved fraud flag`,
                ]
                  .filter(Boolean)
                  .join("; ")}
                .
              </p>
            </Banner>
          )}

          {singleProject ? (
            <>
              <ProjectHero project={summary.projects[0]} info={projects.find((p) => p.projectid === summary.projects[0].projectId)} period={summary.period} />
              <div className="reports-grid">
                <Card>
                  <h3 className="reports-section-title">Where the budget stands</h3>
                  <p className="reports-chart-note">Spend before and during the period against what is left.</p>
                  <BudgetStands project={summary.projects[0]} />
                </Card>
                <Card>
                  <h3 className="reports-section-title">Budget used to date</h3>
                  <p className="reports-chart-note">Also printed in the PDF.</p>
                  <BudgetChart ref={chartRef} projects={summary.projects} />
                </Card>
              </div>
            </>
          ) : (
            <>
              <SummaryCards totals={summary.totals} periodTo={summary.period.to} />

              <div className="reports-grid">
                <Card>
                  <h3 className="reports-section-title">Budget used to date</h3>
                  <p className="reports-chart-note">Each bar fills as a project spends its budget. Red means over budget. Also printed in the PDF.</p>
                  <BudgetChart ref={chartRef} projects={summary.projects} />
                </Card>
                <Card>
                  <h3 className="reports-section-title">Where this period's spend went</h3>
                  <p className="reports-chart-note">Share of the period spend by project.</p>
                  <SpendShare projects={summary.projects} total={summary.totals.periodSpend} />
                </Card>
              </div>

              <Card>
                <h3 className="reports-section-title">Cost variance against budget</h3>
                <p className="reports-chart-note">Spend to date minus budget, as a share of each project's budget. Green is under budget, red is over.</p>
                <VarianceChart projects={summary.projects} />
              </Card>

              <Card>
                <h3 className="reports-section-title">Project breakdown</h3>
                <p className="reports-chart-note">Tax-deductible counts only receipts classed Formal-Tax-Deductible, within the chosen dates.</p>
                <ProjectsTable projects={summary.projects} totals={summary.totals} />
              </Card>
            </>
          )}

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
        </section>
      )}
    </div>
  );
}
