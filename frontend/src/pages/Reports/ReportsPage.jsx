import { useState } from "react";
import { getReportSummary } from "../../api/reportsApi";
import { extractErrorMessage } from "../../api/client";
import { useProjects } from "../../utils/useProjects";
import { defaultReportRange, validateReportFilters } from "../../utils/reportFilters";
import { Banner } from "../../components/ui/Banner";
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

  async function generate() {
    const errors = validateReportFilters(filters);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    setError("");
    try {
      setSummary(await getReportSummary(filters));
    } catch (err) {
      setSummary(null);
      setError(extractErrorMessage(err, "Couldn't generate the report."));
    } finally {
      setSubmitting(false);
    }
  }

  const warnings = summary?.warnings;

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
        </>
      )}
    </div>
  );
}
