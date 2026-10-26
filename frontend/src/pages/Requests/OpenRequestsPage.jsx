import { useCallback, useEffect, useMemo, useState } from "react";
import { listOpenRequests } from "../../api/allocationsApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { useLocale } from "../../i18n/LocaleProvider";
import {
  filterByProject,
  filterByVendor,
  groupByProject,
  groupByVendor,
  progressOf,
  vendorOptions,
} from "../../utils/openRequests";
import "./OpenRequestsPage.css";

// The web counterpart of the mobile To Buy list, for the people who watch the buying rather than do it:
// every open material request with what is still to buy, by store or by project. A General Manager
// sees every project; a Project Manager sees the projects they manage (the server scopes the list).

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

/** Render the open requests grouped by store or by project, with a filter and per-request progress. */
export function OpenRequestsPage() {
  const { user } = useAuth();
  const { t, formatNumber } = useLocale();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("store");
  const [vendorFilter, setVendorFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRequests(await listOpenRequests());
    } catch (e) {
      setError(extractErrorMessage(e, t("open_requests.load_failed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const stores = useMemo(() => vendorOptions(requests), [requests]);
  const projects = useMemo(() => groupByProject(requests), [requests]);

  // The filter belongs to the view it was picked in; the other view starts unfiltered.
  const activeVendor = view === "store" && stores.some((s) => s.key === vendorFilter) ? vendorFilter : null;
  const activeProject = view === "project" && projects.some((p) => p.projectId === projectFilter) ? projectFilter : null;

  const shown = useMemo(
    () => (view === "store" ? filterByVendor(requests, activeVendor) : filterByProject(requests, activeProject)),
    [requests, view, activeVendor, activeProject]
  );
  const groups = useMemo(
    () =>
      view === "store"
        ? groupByVendor(shown).map((g) => ({ key: g.key || "none", title: g.vendorName ?? t("tb.all_stores"), requests: g.requests }))
        : groupByProject(shown).map((g) => ({ key: g.projectId, title: g.projectName, requests: g.requests })),
    [view, shown, t]
  );

  if (!user || !["General Manager", "Project Manager"].includes(user.role)) {
    return <Banner tone="error" title={t("auth.not_authorized_title")}>{t("split.not_authorized_body")}</Banner>;
  }

  const unfiltered = view === "store" ? activeVendor === null : activeProject === null;
  const countLabel = (n) => t(n === 1 ? "tb.items_one" : "tb.items_other", { count: n });

  return (
    <div className="open-requests-page">
      <div className="open-requests-header">
        <div>
          <h1>{t("open_requests.title")}</h1>
          <p className="open-requests-subtitle">
            {user.role === "General Manager" ? t("open_requests.subtitle_gm") : t("open_requests.subtitle_pm")}
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={load} disabled={loading}>
          {loading ? t("common.checking") : t("open_requests.refresh")}
        </Button>
      </div>

      {error && <Banner tone="error" title={t("open_requests.load_failed")}>{error}</Banner>}

      <div className="open-requests-controls">
        <div className="open-requests-toggle" role="group" aria-label={t("open_requests.view")}>
          {["store", "project"].map((mode) => (
            <button
              key={mode}
              type="button"
              className={`open-requests-toggle-btn${view === mode ? " open-requests-toggle-on" : ""}`}
              aria-pressed={view === mode}
              onClick={() => setView(mode)}
            >
              {t(mode === "store" ? "tb.view_store" : "tb.view_project")}
            </button>
          ))}
        </div>

        {view === "store" ? (
          <Field as="select" label={t("tb.filter_store")} value={activeVendor ?? ""} onChange={(e) => setVendorFilter(e.target.value)}>
            <option value="">{t("tb.all_stores")}</option>
            {stores.map((s) => <option key={s.key} value={s.key}>{s.vendorName}</option>)}
          </Field>
        ) : (
          <Field as="select" label={t("tb.filter_project")} value={activeProject ?? ""} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="">{t("tb.all_projects")}</option>
            {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.projectName}</option>)}
          </Field>
        )}
      </div>

      {!loading && groups.length === 0 && !error && (
        <Banner tone="empty" title={t("open_requests.empty_title")}>{t("open_requests.empty_body")}</Banner>
      )}

      {groups.length > 0 && unfiltered && (
        <div className="open-requests-all" role="heading" aria-level={2}>
          <strong>{t(view === "store" ? "tb.all_stores" : "tb.all_projects")}</strong>
          <span>{countLabel(shown.length)}</span>
        </div>
      )}

      {groups.map((group) => (
        <Card key={group.key} className="open-requests-group">
          <div className="open-requests-group-head">
            <h2>{group.title}</h2>
            <span className="open-requests-count">{countLabel(group.requests.length)}</span>
          </div>
          <ul className="open-requests-list">
            {group.requests.map((request) => {
              const progress = progressOf(request);
              return (
                <li key={request.ticketID} className="open-requests-row">
                  <div className="open-requests-row-main">
                    <strong>{request.subject}</strong>
                    <span className="open-requests-meta">
                      {t("tb.need_line", {
                        quantity: formatNumber ? formatNumber(request.requestedQuantity) : request.requestedQuantity,
                        material: request.materialType,
                        project: request.projectName,
                      })}
                      {view === "project" && request.vendorName ? ` · ${request.vendorName}` : ""}
                    </span>
                  </div>
                  <div className="open-requests-progress">
                    <div className="open-requests-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress.quantityShare ?? 0) * 100)}>
                      <div className="open-requests-fill" style={{ width: `${Math.round((progress.quantityShare ?? 0) * 100)}%` }} />
                    </div>
                    <span className="open-requests-meta">
                      {t("tb.progress_qty", { bought: progress.bought, total: progress.requested })}
                      {progress.budget != null ? ` · ${t("open_requests.budget_left", { left: PESO.format(Number(request.remainingBudget ?? progress.budget)) })}` : ""}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
