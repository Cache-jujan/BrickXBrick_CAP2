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
import { useLocale } from "../../i18n/LocaleProvider";
import "./ReportsPage.css";

const STAMP_OPTIONS = { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" };

// FUNCTION F11 — Financial Analytics and Reporting (General Manager only).
// Generate asks GET /api/reports/summary; the server does all the maths, this
// page only shows it. The cards describe the filters that were GENERATED, not
// whatever is currently typed in the form, so a half-edited date never makes
// the numbers look like they belong to a different period.
export function ReportsPage() {
  const { t, formatDate } = useLocale();
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
    const errors = validateReportFilters(filters, t);
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
      setError(extractErrorMessage(err, t("errors.report_failed")));
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
      setExportError(extractErrorMessage(err, t("errors.export_failed")));
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
        retryMessage: result.anchorStatus === "Confirmed" ? "" : t("rep.anchor_unavailable"),
      }));
    } catch (err) {
      setExportResult((r) => ({ ...r, retrying: false, retryMessage: extractErrorMessage(err, t("errors.anchor_failed")) }));
    }
  }

  return (
    <div className="reports-page">
      <div className="page-header">
        <div className="page-header-text">
          <h1>{t("nav.reports")}</h1>
          <p className="page-header-sub">{t("rep.subtitle")}</p>
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
          <p className="reports-placeholder-title">{t("rep.placeholder_title")}</p>
          <p>{t("rep.placeholder_body")}</p>
        </div>
      )}

      {problems.length > 0 && (
        <div ref={problemsRef}>
          <Banner tone="error" title={t("rep.not_generated")}>
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
          title={t("rep.empty_title")}
          action={
            selectedProjects.length > 0 && (
              <Button variant="secondary" onClick={useProjectDates}>
                {t("rep.use_project_dates")}
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
              t,
              formatDate,
            }).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </Banner>
      )}

      {summary && !summary.empty && (
        <section className="reports-results" aria-label={t("rep.results_aria")}>
          <div className="reports-results-head">
            <div>
              <h2 className="reports-results-title">{singleProject ? t("rep.title_project") : t("rep.title_results")}</h2>
              <p className="reports-stamp">
                {t("rep.stamp", { from: summary.period.from, to: summary.period.to, time: formatDate(summary.generatedAt, STAMP_OPTIONS) })}
              </p>
            </div>
            <div className="reports-export">
              <Button onClick={exportPdf} disabled={exporting}>
                {exporting ? t("rep.preparing_pdf") : t("rep.export_pdf")}
              </Button>
              <span className="reports-export-note">{t("rep.export_note")}</span>
            </div>
          </div>

          {(warnings.pendingExpenses > 0 || warnings.fraudFlaggedExpenses > 0) && (
            <Banner tone="warning" title={t("rep.may_change")}>
              <p>
                {[
                  warnings.pendingExpenses > 0 && (warnings.pendingExpenses === 1 ? t("rep.pending_one") : t("rep.pending_other", { count: warnings.pendingExpenses })),
                  warnings.fraudFlaggedExpenses > 0 && (warnings.fraudFlaggedExpenses === 1 ? t("rep.fraud_one") : t("rep.fraud_other", { count: warnings.fraudFlaggedExpenses })),
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
                  <h3 className="reports-section-title">{t("rep.budget_stands")}</h3>
                  <p className="reports-chart-note">{t("rep.budget_stands_note")}</p>
                  <BudgetStands project={summary.projects[0]} />
                </Card>
                <Card>
                  <h3 className="reports-section-title">{t("rep.budget_used")}</h3>
                  <p className="reports-chart-note">{t("rep.also_pdf")}</p>
                  <BudgetChart ref={chartRef} projects={summary.projects} />
                </Card>
              </div>
            </>
          ) : (
            <>
              <SummaryCards totals={summary.totals} periodTo={summary.period.to} />

              <div className="reports-grid">
                <Card>
                  <h3 className="reports-section-title">{t("rep.budget_used")}</h3>
                  <p className="reports-chart-note">{t("rep.budget_used_note")}</p>
                  <BudgetChart ref={chartRef} projects={summary.projects} />
                </Card>
                <Card>
                  <h3 className="reports-section-title">{t("rep.spend_went")}</h3>
                  <p className="reports-chart-note">{t("rep.spend_share_note")}</p>
                  <SpendShare projects={summary.projects} total={summary.totals.periodSpend} />
                </Card>
              </div>

              <Card>
                <h3 className="reports-section-title">{t("rep.variance_title")}</h3>
                <p className="reports-chart-note">{t("rep.variance_note")}</p>
                <VarianceChart projects={summary.projects} />
              </Card>

              <Card>
                <h3 className="reports-section-title">{t("rep.breakdown")}</h3>
                <p className="reports-chart-note">{t("rep.breakdown_note")}</p>
                <ProjectsTable projects={summary.projects} totals={summary.totals} />
              </Card>
            </>
          )}

          {exportError && <Banner tone="error" title={exportError} />}

          {exportResult && exportResult.anchorStatus === "Confirmed" && (
            <Banner tone="success" title={t("rep.secured_title")}>
              {t("rep.secured_body")}
            </Banner>
          )}

          {exportResult && exportResult.anchorStatus !== "Confirmed" && (
            <Banner
              tone="warning"
              title={t("rep.pending_title")}
              action={
                <Button variant="secondary" onClick={retryAnchor} disabled={exportResult.retrying}>
                  {exportResult.retrying ? t("rep.trying") : t("common.try_again")}
                </Button>
              }
            >
              <p>{t("rep.pending_body")}</p>
              {exportResult.retryMessage && <p>{exportResult.retryMessage}</p>}
            </Banner>
          )}
        </section>
      )}
    </div>
  );
}
