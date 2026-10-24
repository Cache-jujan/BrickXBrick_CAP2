import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useProjects } from "../../utils/useProjects";
import { Banner } from "../../components/ui/Banner";
import { Badge } from "../../components/ui/Badge";
import { AssignmentLimitsCard } from "../../components/projects/AssignmentLimitsCard";
import { useLocale } from "../../i18n/LocaleProvider";
import "./ProjectsListPage.css";

const STATUS_FILTERS = ["All", "Draft", "Active", "Completed", "Cancelled", "Archived"];

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

export function ProjectsListPage() {
  const { user } = useAuth();
  const { t, tv, formatDate } = useLocale();
  const fmtDate = (value) => (value ? formatDate(value) : null);
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");
  const { projects, loading, error } = useProjects(
    statusFilter === "All" ? undefined : statusFilter
  );
  const canCreate = user.role === "General Manager";

  // A Project Manager can only open projects assigned to them, so only
  // list those. General Manager sees everything.
  const visible = useMemo(() => {
    const scoped =
      user.role === "Project Manager"
        ? projects.filter((p) => p.projectmanagerid === user.id)
        : projects;
    const q = search.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((p) =>
      [p.name, p.clientname, p.projectmanagername, p.municipality]
        .some((field) => (field || "").toLowerCase().includes(q))
    );
  }, [projects, search, user.role, user.id]);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h1>{t("nav.projects")}</h1>
          {!loading && !error && (
            <p className="page-header-sub">
              {visible.length === 1 ? t("projects.count_one") : t("projects.count_other", { count: visible.length })}
              {statusFilter !== "All" ? ` · ${tv("status", statusFilter)}` : ""}
            </p>
          )}
        </div>
        {canCreate && (
          <div className="page-header-actions">
            <Link to="/projects/new" className="btn btn-primary">{t("nav.new_project")}</Link>
          </div>
        )}
      </div>

      {canCreate && <AssignmentLimitsCard />}

      <div className="projects-toolbar">
        <div className="projects-tabs" role="tablist" aria-label={t("projects.filter_status")}>
          {STATUS_FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={statusFilter === option}
              className={"projects-tab" + (statusFilter === option ? " projects-tab-active" : "")}
              onClick={() => setStatusFilter(option)}
            >
              {tv("status", option)}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="projects-search"
          placeholder={t("projects.search_placeholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t("projects.search_label")}
        />
      </div>

      {error && <Banner tone="error" title={error} />}

      {!error && loading && <p className="dashboard-loading">{t("dashboard.loading_projects")}</p>}

      {!error && !loading && visible.length === 0 && (
        <Banner
          tone="empty"
          title={
            search
              ? t("projects.no_match")
              : statusFilter === "All"
              ? t("projects.none")
              : t("projects.none_status", { status: tv("status", statusFilter).toLowerCase() })
          }
        >
          {search
            ? t("projects.try_different")
            : canCreate && statusFilter === "All"
            ? t("projects.create_hint")
            : t("projects.assigned_hint")}
        </Banner>
      )}

      {!error && !loading && visible.length > 0 && (
        <div className="table-scroll projects-table-wrap">
          <table className="users-table projects-table">
            <thead>
              <tr>
                <th>{t("nav.project")}</th>
                <th>{t("dashboard.status")}</th>
                <th>Project Manager</th>
                <th>Site Manager</th>
                <th>{t("projects.location")}</th>
                <th>{t("projects.construction")}</th>
                <th className="num">{t("projects.budget")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const from = fmtDate(p.constructionstartdate);
                const to = fmtDate(p.enddate);
                return (
                  <tr
                    key={p.projectid}
                    className="projects-row"
                    onClick={() => navigate(`/projects/${p.projectid}`)}
                  >
                    <td>
                      <Link to={`/projects/${p.projectid}`} className="projects-name" onClick={(e) => e.stopPropagation()}>
                        {p.name}
                      </Link>
                      <span className="projects-client">{p.clientname}</span>
                    </td>
                    <td><Badge status={p.status} /></td>
                    <td>{p.projectmanagername || <span className="muted">—</span>}</td>
                    <td>{p.sitemanagername || <span className="muted">{t("projects.not_assigned")}</span>}</td>
                    <td>{p.municipality || <span className="muted">—</span>}</td>
                    <td className="projects-dates">
                      {from || to ? (
                        <>
                          {from || "—"}
                          <span className="muted"> {t("projects.to")} </span>
                          {to || "—"}
                        </>
                      ) : (
                        <span className="muted">{t("projects.not_set")}</span>
                      )}
                    </td>
                    <td className="num">{PESO.format(p.budget)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
