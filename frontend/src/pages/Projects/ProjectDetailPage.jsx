import { Fragment, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  activateProject,
  cancelProject,
  completeProject,
  getEligibleSiteManagers,
  getProjectOverview,
  updateProjectSiteManager,
} from "../../api/projectsApi";
import { createMilestone } from "../../api/milestonesApi";
import { createTask, completeTask } from "../../api/tasksApi";
import { listExpenses, approveExpense, rejectExpense } from "../../api/expensesApi";
import { getProjectBlockchainSummary, verifyExpense } from "../../api/blockchainApi";
import { getBom } from "../../api/bomApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { ProgressBar } from "../../components/milestones/ProgressBar";
import { ProjectTimeline } from "../../components/milestones/ProjectTimeline";
import { TaskDocumentsDialog } from "../../components/milestones/TaskDocumentsDialog";
import { EditTimelineModal } from "../../components/milestones/EditTimelineModal";
import { ManagerPicker } from "../../components/projects/ManagerPicker";
import { BackLink } from "../../components/ui/BackLink";
import { ExpenseProtection } from "../../components/blockchain/ExpenseProtection";
import { useLocale } from "../../i18n/LocaleProvider";
import "./ProjectDetailPage.css";

const PESO_WHOLE = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
const PESO_CENTS = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });
// Whole pesos stay short; amounts with centavos keep them (BOM totals often have them).
const PESO = {
  format: (value) => {
    const n = Number(value || 0);
    return (Math.abs(n * 100 - Math.round(n) * 100) < 0.5 ? PESO_WHOLE : PESO_CENTS).format(n);
  },
};
const LONG_DATE = { year: "numeric", month: "long", day: "numeric" };
const DATETIME_OPTIONS = { dateStyle: "medium", timeStyle: "short" };
const CLOSED_STATUSES = ["Completed", "Cancelled", "Archived"];

export function ProjectDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t, tv, formatDate } = useLocale();
  const fmtLong = (value) => (value ? formatDate(value, LONG_DATE) : t("projects.not_set"));
  const canReview = user.role === "General Manager" || user.role === "Project Manager";
  const canVerify = user.role === "General Manager"; // matches backend requireRole on /verify/:id

  const [project, setProject] = useState(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [expenses, setExpenses] = useState([]);
  const [expensesError, setExpensesError] = useState("");
  const [expensesLoading, setExpensesLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [actionError, setActionError] = useState("");
  // Reject needs a reason (the API returns 400 without one), so it goes
  // through a small modal: { expense } while open.
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);

  const [chainSummary, setChainSummary] = useState(null);
  const [chainError, setChainError] = useState("");
  const [chainLoading, setChainLoading] = useState(true);
  const [verifyResults, setVerifyResults] = useState({}); // { [expenseId]: result }
  const [verifyingId, setVerifyingId] = useState(null);
  const [siteManagers, setSiteManagers] = useState([]);
  const [siteManagersError, setSiteManagersError] = useState("");
  const [siteManagerSaving, setSiteManagerSaving] = useState(false);
  // GM lifecycle actions: { kind: "activate" | "cancel" | "complete" } while a dialog is open.
  const [statusDialog, setStatusDialog] = useState(null);
  const [statusInput, setStatusInput] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState("");
  // F2: the project's Bill of Materials summary (GM and owning PM).
  const [bomInfo, setBomInfo] = useState(null);
  const [bomError, setBomError] = useState("");
  // F3: milestone/task creation happens in-place via modals (was a separate
  // page). taskDialog carries the milestone it targets so the title can name it.
  const [milestoneDialog, setMilestoneDialog] = useState(false);
  // #5: phase picks how the milestone's tasks get owned — Planning tasks are
  // "Handled by: GM/PM" with no Site Manager involved, Construction tasks
  // keep the existing SM-assignment flow. Defaults to Construction so this
  // form behaves exactly like before unless the PM changes it.
  const [milestoneForm, setMilestoneForm] = useState({ name: "", dueDate: "", phase: "Construction" });
  const [milestoneBusy, setMilestoneBusy] = useState(false);
  const [milestoneError, setMilestoneError] = useState("");
  const [taskDialog, setTaskDialog] = useState(null); // { milestone } | null
  const [taskForm, setTaskForm] = useState({ taskName: "", dueDate: "", handledBy: "PM" });
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskError, setTaskError] = useState("");
  // #5: the backend never rejects an out-of-phase-window due date, it just
  // flags it back — surfaced here as a dismissible info banner after a
  // successful create, not inside the (by-then-closed) modal.
  const [scheduleWarning, setScheduleWarning] = useState("");
  // #5: a Planning task has no SM review flow — the owning PM marks it done
  // directly. { task } while a confirm dialog is open.
  // Planning-task documents dialog: the task whose files are open, or null.
  const [docsTask, setDocsTask] = useState(null);
  // The PM's "Edit timeline" modal (rename, re-date, delete milestones and tasks).
  const [timelineDialog, setTimelineDialog] = useState(false);
  const [completeDialog, setCompleteDialog] = useState(null);
  const [completeNote, setCompleteNote] = useState("");
  const [completeBusy, setCompleteBusy] = useState(false);
  const [completeError, setCompleteError] = useState("");
  // Site Manager assignment moved from an always-open picker into a modal.
  const [smDialog, setSmDialog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setAccessDenied(false);
    getProjectOverview(id)
      .then((data) => {
        if (!cancelled) setProject(data);
      })
      .catch((err) => {
        if (cancelled) return;
        // assertProjectAccess in projects.js 403s a Project Manager who
        // isn't this project's projectmanagerid — a reachable, expected
        // state rather than an actual error.
        if (err?.response?.status === 403) {
          setAccessDenied(true);
        } else {
          setError(extractErrorMessage(err, t("errors.load_project")));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per project, not on a language change
  }, [id]);

  const isGM = user.role === "General Manager";
  const isClosed = Boolean(project && CLOSED_STATUSES.includes(project.status));
  const canManageSiteManager = Boolean(
    project && !isClosed && (
      isGM ||
      (user.role === "Project Manager" && project.projectmanagerid === user.id)
    )
  );

  useEffect(() => {
    if (!canManageSiteManager) return undefined;
    let cancelled = false;
    setSiteManagersError("");
    getEligibleSiteManagers(id)
      .then((data) => { if (!cancelled) setSiteManagers(data); })
      .catch((err) => {
        if (!cancelled) setSiteManagersError(extractErrorMessage(err, t("errors.load_site_managers")));
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per project, not on a language change
  }, [canManageSiteManager, id]);

  useEffect(() => {
    if (!project) return undefined;
    let cancelled = false;
    setBomError("");
    getBom(id)
      .then((data) => { if (!cancelled) setBomInfo(data); })
      .catch((err) => { if (!cancelled) setBomError(extractErrorMessage(err, t("errors.load_bom"))); });
    return () => { cancelled = true; };
    // Reload when the project's BOM status changes (e.g. after activation).
  }, [id, project?.bomstatus, Boolean(project)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setExpensesLoading(true);
    setExpensesError("");
    listExpenses(id)
      .then((data) => { if (!cancelled) setExpenses(data); })
      .catch((err) => { if (!cancelled) setExpensesError(extractErrorMessage(err, t("errors.load_project_expenses"))); })
      .finally(() => { if (!cancelled) setExpensesLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per project, not on a language change
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setChainLoading(true);
    setChainError("");
    getProjectBlockchainSummary(id)
      .then((data) => { if (!cancelled) setChainSummary(data); })
      .catch((err) => { if (!cancelled) setChainError(extractErrorMessage(err, t("errors.load_chain"))); })
      .finally(() => { if (!cancelled) setChainLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per project, not on a language change
  }, [id]);

  async function refreshAfterReview() {
    setExpenses(await listExpenses(id));
    setChainSummary(await getProjectBlockchainSummary(id));
  }

  async function handleApprove(expenseId) {
    setActionError("");
    try {
      await approveExpense(expenseId);
      await refreshAfterReview();
    } catch (err) {
      setActionError(extractErrorMessage(err, t("errors.expense_approve")));
    }
  }

  function openReject(expense) {
    setActionError("");
    setRejectReason("");
    setRejecting(expense);
  }

  function closeReject() {
    if (rejectBusy) return;
    setRejecting(null);
    setRejectReason("");
    setActionError("");
  }

  async function handleReject() {
    if (!rejecting || !rejectReason.trim() || rejectBusy) return;
    setRejectBusy(true);
    setActionError("");
    try {
      await rejectExpense(rejecting.expenseid, rejectReason.trim());
      setRejecting(null);
      setRejectReason("");
      await refreshAfterReview();
    } catch (err) {
      setActionError(extractErrorMessage(err, t("errors.expense_reject")));
    } finally {
      setRejectBusy(false);
    }
  }

  async function handleVerify(expenseId) {
    setVerifyingId(expenseId);
    try {
      const result = await verifyExpense(expenseId);
      setVerifyResults((prev) => ({ ...prev, [expenseId]: result }));
      if (!result.verified) {
        setChainSummary(await getProjectBlockchainSummary(id));
      }
    } catch (err) {
      setVerifyResults((prev) => ({
        ...prev,
        [expenseId]: { verified: false, error: extractErrorMessage(err, t("errors.verify_failed")) },
      }));
    } finally {
      setVerifyingId(null);
    }
  }

  async function handleSiteManagerChange(value) {
    const siteManagerId = value || null;
    setSiteManagerSaving(true);
    setSiteManagersError("");
    try {
      const updated = await updateProjectSiteManager(id, siteManagerId);
      setProject((previous) => ({ ...previous, ...updated }));
      setSiteManagers(await getEligibleSiteManagers(id));
      return true;
    } catch (err) {
      setSiteManagersError(extractErrorMessage(err, t("errors.update_sm")));
      return false;
    } finally {
      setSiteManagerSaving(false);
    }
  }

  function openMilestoneDialog() {
    setMilestoneError("");
    setMilestoneForm({ name: "", dueDate: "", phase: "Construction" });
    setMilestoneDialog(true);
  }

  function closeMilestoneDialog() {
    if (milestoneBusy) return;
    setMilestoneDialog(false);
  }

  async function handleCreateMilestone() {
    if (milestoneBusy) return;
    if (!milestoneForm.name.trim() || !milestoneForm.dueDate) {
      setMilestoneError(t("pd.err_milestone_required"));
      return;
    }
    setMilestoneBusy(true);
    setMilestoneError("");
    try {
      // milestones.js destructures projectID (capital ID) off req.body.
      const created = await createMilestone({
        projectID: id,
        name: milestoneForm.name.trim(),
        dueDate: milestoneForm.dueDate,
        phase: milestoneForm.phase,
      });
      setProject(await getProjectOverview(id));
      setMilestoneDialog(false);
      setScheduleWarning((created.warnings || [])[0] || "");
    } catch (err) {
      setMilestoneError(extractErrorMessage(err, t("errors.create_milestone")));
    } finally {
      setMilestoneBusy(false);
    }
  }

  function openTaskDialog(milestone) {
    setTaskError("");
    setTaskForm({ taskName: "", dueDate: "", handledBy: "PM" });
    setTaskDialog({ milestone });
  }

  function closeTaskDialog() {
    if (taskBusy) return;
    setTaskDialog(null);
  }

  async function handleCreateTask() {
    if (!taskDialog || taskBusy) return;
    if (!taskForm.taskName.trim() || !taskForm.dueDate) {
      setTaskError(t("pd.err_task_required"));
      return;
    }
    const isPlanning = taskDialog.milestone.phase === "Planning";
    setTaskBusy(true);
    setTaskError("");
    try {
      const created = await createTask(taskDialog.milestone.milestoneid, {
        taskName: taskForm.taskName.trim(),
        dueDate: taskForm.dueDate,
        ...(isPlanning ? { handledBy: taskForm.handledBy } : {}),
      });
      setProject(await getProjectOverview(id));
      setTaskDialog(null);
      setScheduleWarning((created.warnings || [])[0] || "");
    } catch (err) {
      setTaskError(extractErrorMessage(err, t("errors.create_task")));
    } finally {
      setTaskBusy(false);
    }
  }

  // The modal has already saved everything. Close it, show the first date
  // warning (if any), and reload the project so the timeline matches.
  async function handleTimelineSaved(result) {
    setTimelineDialog(false);
    const warnings = result.warnings || [];
    setScheduleWarning(
      warnings.length > 1 ? `${warnings[0]} (and ${warnings.length - 1} more)` : warnings[0] || ""
    );
    try {
      setProject(await getProjectOverview(id));
    } catch {
      setScheduleWarning("Your changes were saved, but the page couldn't refresh. Reload to see them.");
    }
  }

  function openCompleteDialog(task) {
    setCompleteError("");
    setCompleteNote("");
    setCompleteDialog({ task });
  }

  function closeCompleteDialog() {
    if (completeBusy) return;
    setCompleteDialog(null);
  }

  async function handleCompleteTask() {
    if (!completeDialog || completeBusy) return;
    setCompleteBusy(true);
    setCompleteError("");
    try {
      await completeTask(completeDialog.task.taskid, { note: completeNote.trim() || undefined });
      setProject(await getProjectOverview(id));
      setCompleteDialog(null);
    } catch (err) {
      setCompleteError(extractErrorMessage(err, t("errors.complete_task")));
    } finally {
      setCompleteBusy(false);
    }
  }

  function openStatusDialog(kind) {
    setStatusError("");
    setStatusInput(kind === "complete" ? new Date().toISOString().slice(0, 10) : "");
    setStatusDialog({ kind });
  }

  function closeStatusDialog() {
    if (statusBusy) return;
    setStatusDialog(null);
    setStatusError("");
  }

  async function handleStatusAction() {
    if (!statusDialog || statusBusy) return;
    setStatusBusy(true);
    setStatusError("");
    try {
      if (statusDialog.kind === "activate") await activateProject(id);
      if (statusDialog.kind === "cancel") await cancelProject(id, statusInput.trim());
      if (statusDialog.kind === "complete") await completeProject(id, statusInput);
      setProject(await getProjectOverview(id));
      setStatusDialog(null);
    } catch (err) {
      setStatusError(extractErrorMessage(err, t("errors.update_status")));
    } finally {
      setStatusBusy(false);
    }
  }

  if (loading) return <p className="dashboard-loading">{t("projects.loading_one")}</p>;

  if (accessDenied) {
    return (
      <div className="project-detail-terminal">
        <Banner tone="info" title={t("bom.no_access_title")}>
          {t("pd.no_access_body")}
        </Banner>
        <BackLink to="/projects">{t("projects.back")}</BackLink>
      </div>
    );
  }
  if (error) {
    return (
      <div className="project-detail-terminal">
        <Banner tone="error" title={error} />
        <BackLink to="/projects">{t("projects.back")}</BackLink>
      </div>
    );
  }
  if (!project) return null;

  // Only approved expenses count against the budget; pending ones are shown
  // separately so the GM can see what is about to land.
  const approvedTotal = expenses.filter((e) => e.status === "Approved").reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const pendingTotal = expenses.filter((e) => e.status === "Pending").reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const budget = Number(project.budget || 0);
  const budgetUsedPct = budget > 0 ? Math.round((approvedTotal / budget) * 100) : 0;
  // Overall completion = mean of milestone completion %, computed server-side
  // (projects.js DETAIL_SELECT) and carried on the overview payload.
  const progressPct = Math.round(Number(project.progress || 0));
  const location = [project.siteaddress, project.municipality, project.province].filter(Boolean).join(", ");

  // Only the owning Project Manager may add milestones/tasks — mirrors
  // getOwnedProject's check in backend/src/routes/milestones.js.
  const canManage = user.role === "Project Manager" && project.projectmanagerid === user.id && !isClosed;
  // Planning-task documents: the GM (any project) or the owning PM may open
  // them (the backend enforces the same); changing them stops once the
  // project is closed or the task is completed.
  const canViewTaskDocuments = isGM || (user.role === "Project Manager" && project.projectmanagerid === user.id);
  const hasSiteManager = Boolean(project.sitemanagerid);
  // Daily check-ins exist once a project has been activated: the GM and the owning PM can read them.
  const showCheckinsLink = project.status !== "Draft" && (isGM || (user.role === "Project Manager" && project.projectmanagerid === user.id));
  const bom = bomInfo?.bom || null;
  const bomApproved = project.bomstatus === "Approved";
  const bomWarningCount = (bom?.warnings || []).filter((w) => w.level === "warning").length;
  const activationChecks = [
    { label: t("pd.check_pm"), done: Boolean(project.projectmanagerid) },
    { label: t("pd.check_sm"), done: hasSiteManager },
    {
      label:
        bomApproved && bom?.clientAgreedOn
          ? t(bom.clientAgreedBy ? "pd.check_bom_agreed_by" : "pd.check_bom_agreed", {
              date: formatDate(`${bom.clientAgreedOn}T00:00:00`, { dateStyle: "medium" }),
              who: bom.clientAgreedBy,
            })
          : t("pd.check_bom"),
      done: bomApproved,
    },
  ];
  const readyToActivate = activationChecks.every((c) => c.done);

  return (
    <div className="project-detail">
      <BackLink to="/projects">{t("projects.back")}</BackLink>

      <header className="pd-header">
        <div className="pd-header-text">
          <div className="pd-title-row">
            <h1>{project.name}</h1>
            <Badge status={project.status} />
          </div>
          <p className="pd-meta">
            {[project.clientname, project.projecttype, project.municipality].filter(Boolean).join(" · ")}
          </p>
        </div>
        {((isGM && !isClosed) || showCheckinsLink) && (
          <div className="page-header-actions">
            {showCheckinsLink && (
              <Link to={`/projects/${project.projectid}/checkins`} className="btn btn-secondary">{t("pd.daily_checkins")}</Link>
            )}
            {isGM && !isClosed && (<>
            <Button variant="danger" onClick={() => openStatusDialog("cancel")}>{t("pd.cancel_project")}</Button>
            <Link to={`/projects/${project.projectid}/edit`} className="btn btn-secondary">{t("pd.edit_details")}</Link>
            {project.status === "Draft" && (
              <Button onClick={() => openStatusDialog("activate")}>{t("pd.activate")}</Button>
            )}
            {project.status === "Active" && (
              <Button onClick={() => openStatusDialog("complete")}>{t("pd.mark_completed")}</Button>
            )}
            </>)}
          </div>
        )}
      </header>

      {project.status === "Draft" && (
        <Banner tone="info" title={t("pd.draft_title")}>
          {t("pd.draft_body")}
          {!readyToActivate &&
            ` ${t("pd.still_needed", { list: activationChecks.filter((c) => !c.done).map((c) => c.label).join(", ") })}`}
        </Banner>
      )}
      {project.status === "Cancelled" && (
        <Banner tone="warning" title={t("pd.cancelled_title")}>
          {project.cancellationreason}
          {project.cancelledat ? ` (${formatDate(project.cancelledat, DATETIME_OPTIONS)})` : ""}
        </Banner>
      )}
      {(project.warnings || []).map((w) => (
        <Banner key={w.code} tone="warning" title={w.message} />
      ))}

      {project.description && <p className="pd-description">{project.description}</p>}

      <section className="pd-summary" aria-label={t("pd.summary")}>
        <div className="pd-group">
          <h2 className="pd-group-title">{t("projects.budget")}</h2>
          <dl>
            <div><dt>{t("pd.target_budget")}</dt><dd className="num-left">{PESO.format(budget)}</dd></div>
            <div>
              <dt>{t("dashboard.approved_spending")}</dt>
              <dd className="num-left">
                {PESO.format(approvedTotal)} <span className="pd-dd-note">{t("pd.of_budget", { percent: budgetUsedPct })}</span>
              </dd>
            </div>
            <div>
              <dt>{t("pd.waiting_approval")}</dt>
              <dd className="num-left">{pendingTotal ? PESO.format(pendingTotal) : <span className="pd-dd-note">{t("split.none")}</span>}</dd>
            </div>
            <div className="pd-progress">
              <dt>{t("pd.work_progress")}</dt>
              <dd>
                <div className="pd-progress-track">
                  <ProgressBar value={progressPct} />
                  <span className="pd-progress-pct">{progressPct}%</span>
                </div>
              </dd>
            </div>
          </dl>
        </div>
        <div className="pd-group">
          <h2 className="pd-group-title">{t("form.section_timeline")}</h2>
          <dl>
            <div><dt>{t("form.date_dev")}</dt><dd>{fmtLong(project.startdate)}</dd></div>
            <div><dt>{t("form.date_construction")}</dt><dd>{fmtLong(project.constructionstartdate)}</dd></div>
            <div><dt>{t("form.date_end")}</dt><dd>{fmtLong(project.enddate)}</dd></div>
            {project.actualcompletiondate && (
              <div><dt>{t("pd.turnover")}</dt><dd>{fmtLong(project.actualcompletiondate)}</dd></div>
            )}
          </dl>
        </div>
        <div className="pd-group">
          <h2 className="pd-group-title">{t("form.section_site")}</h2>
          <dl>
            <div><dt>{t("pd.type")}</dt><dd>{project.projecttype || t("projects.not_set")}</dd></div>
            <div><dt>{t("projects.location")}</dt><dd>{location || t("projects.not_set")}</dd></div>
            <div><dt>{t("pd.client")}</dt><dd>{project.clientname}</dd></div>
            {project.createdfromtemplatename && (
              <div><dt>{t("pd.started_from")}</dt><dd>{t("pd.from_template", { name: project.createdfromtemplatename })}</dd></div>
            )}
            {project.copiedfromprojectname && (
              <div><dt>{t("pd.started_from")}</dt><dd>{t("pd.copy_of", { name: project.copiedfromprojectname })}</dd></div>
            )}
          </dl>
        </div>
      </section>

      <section className="pd-bom" aria-labelledby="pd-bom-title">
        <div className="section-head">
          <h2 id="pd-bom-title">{t("nav.bill_of_materials")}</h2>
          {bom && (
            <Link to={`/projects/${project.projectid}/bom`} className="btn btn-secondary btn-sm">
              {isGM && !isClosed && bom.status === "Draft" ? t("pd.review_approve") : t("pd.open_bom")}
            </Link>
          )}
        </div>
        {bomError && <Banner tone="error" title={bomError} />}
        {!bomError && bomInfo && !bom && (
          <div className="pd-bom-bar pd-bom-empty">
            <p>
              {isGM && !isClosed ? t("pd.bom_add_help") : t("pd.bom_none_gm")}
            </p>
            {isGM && !isClosed && (
              <Link to={`/projects/${project.projectid}/bom`} className="btn btn-primary btn-sm">{t("pd.add_bom")}</Link>
            )}
          </div>
        )}
        {bom && (
          <div className="pd-bom-bar">
            <div className="pd-bom-status">
              <Badge status={bom.status === "Approved" ? "Approved" : "Draft"} />
              <span>
                {bom.status === "Approved"
                  ? bom.approvedAt
                    ? t("pd.bom_approved_at", { date: formatDate(bom.approvedAt, DATETIME_OPTIONS) })
                    : t("status.approved")
                  : bomWarningCount
                    ? bomWarningCount === 1
                      ? t("pd.bom_check_one")
                      : t("pd.bom_check_other", { count: bomWarningCount })
                    : t("pd.bom_not_approved")}
              </span>
            </div>
            <dl className="pd-bom-figures">
              <div><dt>{t("pd.items")}</dt><dd>{t("pd.items_in_sections", { items: bom.totals.itemCount, sections: bom.totals.sectionCount })}</dd></div>
              {/* BOM figures always show centavos, like the BOM itself */}
              <div><dt>{t("bom.materials")}</dt><dd className="num">{PESO_CENTS.format(bom.totals.materials)}</dd></div>
              <div><dt>{t("pd.labor_other")}</dt><dd className="num">{PESO_CENTS.format(bom.totals.labor)}</dd></div>
              <div><dt>{t("pd.total")}</dt><dd className="num pd-bom-total">{PESO_CENTS.format(bom.totals.total)}</dd></div>
            </dl>
          </div>
        )}
      </section>

      <section className="pd-team" aria-labelledby="pd-team-title">
        <div className="section-head">
          <h2 id="pd-team-title">{t("form.section_team")}</h2>
          {isGM && !isClosed && (
            <span className="section-head-note">{t("pd.change_pm_hint")}</span>
          )}
        </div>
        <div className="pd-team-grid">
          <div className="pd-person">
            <p className="pd-person-role">Project Manager</p>
            <p className="pd-person-name">{project.projectmanagername || t("projects.not_assigned")}</p>
            {project.projectmanageremail && <p className="pd-person-email">{project.projectmanageremail}</p>}
          </div>
          <div className="pd-person">
            <p className="pd-person-role">Site Manager</p>
            <p className="pd-person-name">{project.sitemanagername || t("pd.not_assigned_yet")}</p>
            {project.sitemanageremail && <p className="pd-person-email">{project.sitemanageremail}</p>}
            {canManageSiteManager && (
              <div className="pd-person-control">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setSiteManagersError(""); setSmDialog(true); }}
                >
                  {project.sitemanagerid ? t("pd.change") : t("pd.assign_sm")}
                </button>
                {!smDialog && siteManagersError && <p className="field-error">{siteManagersError}</p>}
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="project-detail-milestones">
        {!hasSiteManager && canManage && (
          <Banner tone="info" title={t("pd.no_sm_title")}>
            {t("pd.no_sm_body")}
          </Banner>
        )}
        {scheduleWarning && <Banner tone="warning" title={scheduleWarning} />}
        <ProjectTimeline
          project={project}
          canManage={canManage}
          onAddMilestone={openMilestoneDialog}
          onEditTimeline={() => setTimelineDialog(true)}
          onAddTask={openTaskDialog}
          onCompleteTask={openCompleteDialog}
          onOpenDocuments={canViewTaskDocuments ? setDocsTask : undefined}
        />
      </div>

      <div className="section-head">
        <h2>{t("nav.expenses")}</h2>
        {!expensesLoading && expenses.length > 0 && (
          <span className="section-head-note">{t("pd.recorded", { count: expenses.length, amount: PESO.format(approvedTotal) })}</span>
        )}
      </div>

      {expensesError && <Banner tone="error" title={expensesError} />}
      {actionError && !rejecting && <Banner tone="error" title={actionError} />}
      {!expensesError && expensesLoading && <p className="dashboard-loading">{t("dashboard.loading_expenses")}</p>}
      {!expensesError && !expensesLoading && expenses.length === 0 && (
        <Banner tone="empty" title={t("pd.no_expenses")}>
          {t("pd.no_expenses_body")}
        </Banner>
      )}
      {!expensesError && !expensesLoading && expenses.length > 0 && (
        <Card className="users-table-card">
          <div className="table-scroll">
            <table className="users-table project-detail-table">
              <thead>
                <tr><th>{t("dashboard.vendor")}</th><th>{t("dashboard.category")}</th><th>{t("dashboard.date")}</th><th className="num">{t("dashboard.amount")}</th><th>{t("dashboard.status")}</th></tr>
              </thead>
              <tbody>
                {expenses.map((e) => {
                  const verifyResult = verifyResults[e.expenseid];
                  const isOpen = openId === e.expenseid;
                  return (
                    <Fragment key={e.expenseid}>
                      <tr
                        className={"project-detail-expense-row" + (isOpen ? " project-detail-expense-row-open" : "")}
                        onClick={() => setOpenId(isOpen ? null : e.expenseid)}
                      >
                        <td>{e.vendorname}</td>
                        <td>{tv("category", e.category)}</td>
                        <td>{fmtLong(e.receiptdate)}</td>
                        <td className="num">{PESO.format(e.amount)}</td>
                        <td>
                          <span className="project-detail-badges">
                            <Badge status={e.status} />
                            {e.status === "Approved" && e.blockchainstatus === "TamperDetected" && (
                              <Badge status="Overdue">{t("chain.changed.label")}</Badge>
                            )}
                          </span>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="project-detail-expense-detail">
                          <td colSpan={5}>
                            <div className="expense-detail-grid">
                              <p><strong>{t("expenses.submitted_by")}</strong> {e.submittedbyname}</p>
                              <p><strong>{t("expenses.quantity")}</strong> {e.quantity}</p>
                              <p><strong>{t("expenses.tin")}</strong> {e.tin || "—"}</p>
                              <p><strong>{t("expenses.bir_permit")}</strong> {e.birpermitnumber || "—"}</p>
                            </div>
                            {e.lineitems && (
                              <ul className="expense-detail-items">
                                {(typeof e.lineitems === "string" ? JSON.parse(e.lineitems) : e.lineitems).map((li, i) => (
                                  <li key={i}>{li.description} — {PESO.format(li.amount)}</li>
                                ))}
                              </ul>
                            )}
                            {e.receiptimageurl && (
                              <a href={e.receiptimageurl} target="_blank" rel="noreferrer">{t("expenses.view_receipt")}</a>
                            )}

                            {e.submittedby === user.id && user.role === "General Manager" && (
                              <Banner tone="warning" title={t("expenses.own_title")}>
                                {t("expenses.own_body")}
                              </Banner>
                            )}

                            {canReview && e.status === "Pending" && (
                              e.submittedby === user.id && user.role !== "General Manager" ? (
                                <p>{t("expenses.own_waiting")}</p>
                              ) : (
                                <div className="expense-detail-actions">
                                  <Button onClick={() => handleApprove(e.expenseid)}>{t("expenses.approve")}</Button>
                                  {!(e.submittedby === user.id && user.role === "General Manager") && (
                                    <Button variant="danger" onClick={() => openReject(e)}>{t("expenses.reject")}</Button>
                                  )}
                                </div>
                              )
                            )}

                            {canReview && e.status === "Approved" && (
                              <ExpenseProtection
                                status={e.blockchainstatus}
                                canCheck={canVerify}
                                checking={verifyingId === e.expenseid}
                                result={verifyResult}
                                onCheck={() => handleVerify(e.expenseid)}
                              />
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <section className="record-protection" aria-labelledby="record-protection-title">
        <div className="section-head">
          <h2 id="record-protection-title">{t("nav.record_protection")}</h2>
          <span className="section-head-note">{t("pd.chain_note")}</span>
        </div>

          {chainError && <Banner tone="error" title={chainError} />}
          {!chainError && chainLoading && <p className="dashboard-loading">{t("pd.loading_chain")}</p>}
          {!chainError && !chainLoading && chainSummary && (
            chainSummary.logs.length === 0 ? (
              <Banner tone="empty" title={t("pd.no_chain_title")}>
                {t("pd.no_chain_body")}
              </Banner>
            ) : (
              <Card className="users-table-card">
                <div className="table-scroll">
                  <table className="users-table project-detail-table">
                    <thead>
                      <tr><th>{t("pd.tx_hash")}</th><th>{t("pd.block")}</th><th>{t("pd.validators")}</th><th>{t("pd.recorded_col")}</th></tr>
                    </thead>
                    <tbody>
                      {chainSummary.logs.map((log) => (
                        <tr key={log.txhash}>
                          <td title={log.txhash}>{log.txhash.slice(0, 20)}…</td>
                          <td>{log.blocknumber}</td>
                          <td>{log.validatornodecount}</td>
                          <td>{formatDate(log.timestamp, DATETIME_OPTIONS)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )
          )}
      </section>
      {statusDialog && (
        <div className="modal-overlay" role="presentation" onClick={closeStatusDialog}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="project-status-title" onClick={(ev) => ev.stopPropagation()}>
            {statusDialog.kind === "activate" && (
              <>
                <h2 id="project-status-title" className="modal-title">
                  {readyToActivate ? t("pd.activate_title") : t("pd.not_ready")}
                </h2>
                <ul className="pd-checklist">
                  {activationChecks.map((c) => (
                    <li key={c.label} className={c.done ? "pd-check-done" : "pd-check-missing"}>
                      <span aria-hidden="true">{c.done ? "✓" : "–"}</span> {c.label}
                    </li>
                  ))}
                </ul>
                <p className="modal-body">
                  {readyToActivate ? t("pd.activate_body") : t("pd.complete_missing")}
                </p>
              </>
            )}
            {statusDialog.kind === "complete" && (
              <>
                <h2 id="project-status-title" className="modal-title">{t("pd.complete_title")}</h2>
                <Field
                  label={t("pd.actual_completion")}
                  required
                  type="date"
                  value={statusInput}
                  onChange={(ev) => setStatusInput(ev.target.value)}
                />
              </>
            )}
            {statusDialog.kind === "cancel" && (
              <>
                <h2 id="project-status-title" className="modal-title">{t("pd.cancel_title")}</h2>
                <p className="modal-body">{t("pd.cancel_body")}</p>
                <Field
                  label={t("bom.reason")}
                  required
                  as="textarea"
                  placeholder={t("pd.cancel_reason_ph")}
                  value={statusInput}
                  onChange={(ev) => setStatusInput(ev.target.value)}
                />
              </>
            )}
            {statusError && <Banner tone="error" title={statusError} />}
            <div className="modal-actions">
              <Button variant="secondary" onClick={closeStatusDialog} disabled={statusBusy}>{t("bom.back")}</Button>
              {!(statusDialog.kind === "activate" && !readyToActivate) && <Button
                variant={statusDialog.kind === "cancel" ? "danger" : "primary"}
                onClick={handleStatusAction}
                disabled={
                  statusBusy ||
                  (statusDialog.kind === "activate" ? !readyToActivate : !statusInput.trim())
                }
              >
                {statusBusy ? t("common.saving") : statusDialog.kind === "activate" ? t("pd.activate_btn") : statusDialog.kind === "complete" ? t("pd.complete_btn") : t("pd.cancel_btn")}
              </Button>}
            </div>
          </div>
        </div>
      )}
      {milestoneDialog && (
        <div className="modal-overlay" role="presentation" onClick={closeMilestoneDialog}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pd-milestone-title" onClick={(ev) => ev.stopPropagation()}>
            <h2 id="pd-milestone-title" className="modal-title">{t("pd.add_milestone")}</h2>
            <Field
              label={t("pd.milestone_name")}
              required
              placeholder={t("pd.milestone_ph")}
              value={milestoneForm.name}
              onChange={(ev) => setMilestoneForm((f) => ({ ...f, name: ev.target.value }))}
            />
            <Field
              label={t("mobile.due_date")}
              required
              type="date"
              value={milestoneForm.dueDate}
              onChange={(ev) => setMilestoneForm((f) => ({ ...f, dueDate: ev.target.value }))}
            />
            <Field
              as="select"
              label={t("pd.phase")}
              value={milestoneForm.phase}
              onChange={(ev) => setMilestoneForm((f) => ({ ...f, phase: ev.target.value }))}
            >
              <option value="Construction">{t("projects.construction")}</option>
              <option value="Planning">{t("pd.phase_planning")}</option>
            </Field>
            <p className="modal-body">
              {milestoneForm.phase === "Planning" ? t("pd.milestone_planning_help") : t("pd.milestone_construction_help")}
            </p>
            {milestoneError && <Banner tone="error" title={milestoneError} />}
            <div className="modal-actions">
              <Button variant="secondary" onClick={closeMilestoneDialog} disabled={milestoneBusy}>{t("common.cancel")}</Button>
              <Button onClick={handleCreateMilestone} disabled={milestoneBusy || !milestoneForm.name.trim() || !milestoneForm.dueDate}>
                {milestoneBusy ? t("pd.adding") : t("pd.add_milestone_btn")}
              </Button>
            </div>
          </div>
        </div>
      )}
      {taskDialog && (
        <div className="modal-overlay" role="presentation" onClick={closeTaskDialog}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pd-task-title" onClick={(ev) => ev.stopPropagation()}>
            <h2 id="pd-task-title" className="modal-title">{t("pd.add_task_to", { name: taskDialog.milestone.name })}</h2>
            <p className="modal-body">
              {taskDialog.milestone.phase === "Planning" ? t("pd.task_planning_help") : t("pd.task_auto_help")}
            </p>
            <Field
              label={t("pd.task_name")}
              required
              placeholder={t("pd.task_ph")}
              value={taskForm.taskName}
              onChange={(ev) => setTaskForm((f) => ({ ...f, taskName: ev.target.value }))}
            />
            <Field
              label={t("mobile.due_date")}
              required
              type="date"
              value={taskForm.dueDate}
              onChange={(ev) => setTaskForm((f) => ({ ...f, dueDate: ev.target.value }))}
            />
            {taskDialog.milestone.phase === "Planning" && (
              <Field
                as="select"
                label={t("pd.handled_by")}
                required
                value={taskForm.handledBy}
                onChange={(ev) => setTaskForm((f) => ({ ...f, handledBy: ev.target.value }))}
              >
                <option value="PM">Project Manager</option>
                <option value="GM">General Manager</option>
              </Field>
            )}
            {taskError && <Banner tone="error" title={taskError} />}
            <div className="modal-actions">
              <Button variant="secondary" onClick={closeTaskDialog} disabled={taskBusy}>{t("common.cancel")}</Button>
              <Button onClick={handleCreateTask} disabled={taskBusy || !taskForm.taskName.trim() || !taskForm.dueDate}>
                {taskBusy ? t("pd.adding") : t("pd.add_task_btn")}
              </Button>
            </div>
          </div>
        </div>
      )}
      {timelineDialog && (
        <EditTimelineModal
          project={project}
          onClose={() => setTimelineDialog(false)}
          onSaved={handleTimelineSaved}
        />
      )}
      {docsTask && (
        <TaskDocumentsDialog
          task={docsTask}
          canEdit={canViewTaskDocuments && !isClosed && docsTask.status !== "Completed"}
          onClose={() => setDocsTask(null)}
        />
      )}
      {completeDialog && (
        <div className="modal-overlay" role="presentation" onClick={closeCompleteDialog}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pd-complete-title" onClick={(ev) => ev.stopPropagation()}>
            <h2 id="pd-complete-title" className="modal-title">{t("pd.mark_done_title", { name: completeDialog.task.taskname })}</h2>
            <p className="modal-body">{t("pd.mark_done_body")}</p>
            <Field
              as="textarea"
              label={t("pd.note_optional")}
              placeholder={t("pd.note_ph")}
              value={completeNote}
              onChange={(ev) => setCompleteNote(ev.target.value)}
            />
            {completeError && <Banner tone="error" title={completeError} />}
            <div className="modal-actions">
              <Button variant="secondary" onClick={closeCompleteDialog} disabled={completeBusy}>{t("common.cancel")}</Button>
              <Button onClick={handleCompleteTask} disabled={completeBusy}>
                {completeBusy ? t("pd.marking_done") : t("pd.mark_done")}
              </Button>
            </div>
          </div>
        </div>
      )}
      {smDialog && (
        <div className="modal-overlay" role="presentation" onClick={() => { if (!siteManagerSaving) setSmDialog(false); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pd-sm-title" onClick={(ev) => ev.stopPropagation()}>
            <h2 id="pd-sm-title" className="modal-title">
              {project.sitemanagerid ? t("pd.sm_change_title") : t("pd.assign_sm")}
            </h2>
            <p className="modal-body">{t("pd.sm_help")}</p>
            <ManagerPicker
              label="Site Manager"
              managers={siteManagers}
              loading={false}
              value={project.sitemanagerid || ""}
              currentId={project.sitemanagerid}
              emptyOptionLabel={t("pd.no_sm")}
              disabled={siteManagerSaving || siteManagers.length === 0}
              onChange={async (value) => { const ok = await handleSiteManagerChange(value); if (ok) setSmDialog(false); }}
            />
            {siteManagerSaving && <p className="project-detail-assignment-status">{t("pd.updating_assignment")}</p>}
            {siteManagersError && <Banner tone="error" title={siteManagersError} />}
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setSmDialog(false)} disabled={siteManagerSaving}>{t("pd.close")}</Button>
            </div>
          </div>
        </div>
      )}
      {rejecting && (
        <div className="modal-overlay" role="presentation" onClick={closeReject}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="project-reject-title" onClick={(ev) => ev.stopPropagation()}>
            <h2 id="project-reject-title" className="modal-title">{t("expenses.confirm_reject_title")}</h2>
            <p className="modal-body">
              <strong>{rejecting.vendorname}</strong> · {PESO.format(rejecting.amount)}. {t("pd.reject_body")}
            </p>
            <Field
              label={t("expenses.reason_label")}
              required
              as="textarea"
              placeholder={t("expenses.reason_placeholder")}
              value={rejectReason}
              onChange={(ev) => setRejectReason(ev.target.value)}
            />
            {actionError && <Banner tone="error" title={actionError} />}
            <div className="modal-actions">
              <Button variant="secondary" onClick={closeReject} disabled={rejectBusy}>{t("common.cancel")}</Button>
              <Button variant="danger" onClick={handleReject} disabled={rejectBusy || !rejectReason.trim()}>
                {rejectBusy ? t("common.saving") : t("expenses.reject")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
