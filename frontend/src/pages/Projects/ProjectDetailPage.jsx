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
import { listExpenses, approveExpense, rejectExpense } from "../../api/expensesApi";
import { getProjectBlockchainSummary, verifyExpense } from "../../api/blockchainApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { MilestoneCard } from "../../components/milestones/MilestoneCard";
import { ManagerPicker } from "../../components/projects/ManagerPicker";
import { BackLink } from "../../components/ui/BackLink";
import { ExpenseProtection } from "../../components/blockchain/ExpenseProtection";
import { ShieldCheckIcon } from "../../components/ui/icons";
import "./ProjectDetailPage.css";

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
const DATE = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "long", day: "numeric" });
const DATETIME = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });
const CLOSED_STATUSES = ["Completed", "Cancelled", "Archived"];

function formatDate(value) {
  return value ? DATE.format(new Date(value)) : "Not set";
}

export function ProjectDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
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
          setError(extractErrorMessage(err, "Couldn't load this project."));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
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
        if (!cancelled) setSiteManagersError(extractErrorMessage(err, "Couldn't load Site Managers."));
      });
    return () => { cancelled = true; };
  }, [canManageSiteManager, id]);

  useEffect(() => {
    let cancelled = false;
    setExpensesLoading(true);
    setExpensesError("");
    listExpenses(id)
      .then((data) => { if (!cancelled) setExpenses(data); })
      .catch((err) => { if (!cancelled) setExpensesError(extractErrorMessage(err, "Couldn't load expenses for this project.")); })
      .finally(() => { if (!cancelled) setExpensesLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setChainLoading(true);
    setChainError("");
    getProjectBlockchainSummary(id)
      .then((data) => { if (!cancelled) setChainSummary(data); })
      .catch((err) => { if (!cancelled) setChainError(extractErrorMessage(err, "Couldn't load blockchain audit data.")); })
      .finally(() => { if (!cancelled) setChainLoading(false); });
    return () => { cancelled = true; };
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
      setActionError(extractErrorMessage(err, "Couldn't approve this expense."));
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
      setActionError(extractErrorMessage(err, "Couldn't reject this expense."));
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
        [expenseId]: { verified: false, error: extractErrorMessage(err, "Verification failed.") },
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
    } catch (err) {
      setSiteManagersError(extractErrorMessage(err, "Couldn't update the Site Manager assignment."));
    } finally {
      setSiteManagerSaving(false);
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
      setStatusError(extractErrorMessage(err, "Couldn't update the project status."));
    } finally {
      setStatusBusy(false);
    }
  }

  if (loading) return <p className="dashboard-loading">Loading project…</p>;

  if (accessDenied) {
    return (
      <div className="project-detail-terminal">
        <Banner tone="info" title="You don't manage this project">
          Only this project's assigned Project Manager or a General Manager can view its details.
        </Banner>
        <BackLink to="/projects">Back to Projects</BackLink>
      </div>
    );
  }
  if (error) {
    return (
      <div className="project-detail-terminal">
        <Banner tone="error" title={error} />
        <BackLink to="/projects">Back to Projects</BackLink>
      </div>
    );
  }
  if (!project) return null;

  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const budget = Number(project.budget || 0);
  const budgetUsedPct = budget > 0 ? Math.min(100, Math.round((totalExpenses / budget) * 100)) : 0;

  // Only the owning Project Manager may add milestones/tasks — mirrors
  // getOwnedProject's check in backend/src/routes/milestones.js.
  const canManage = user.role === "Project Manager" && project.projectmanagerid === user.id && !isClosed;
  const hasSiteManager = Boolean(project.sitemanagerid);

  return (
    <div className="project-detail">
      <BackLink to="/projects">Back to Projects</BackLink>

      <div className="spread project-detail-header">
        <div>
          <h1>{project.name}</h1>
          <p className="project-detail-client">{project.clientname}</p>
        </div>
        <div className="project-detail-header-actions">
          <Badge status={project.status} />
          {isGM && !isClosed && (
            <Link to={`/projects/${project.projectid}/edit`} className="btn btn-secondary">Edit Details</Link>
          )}
          {isGM && project.status === "Draft" && (
            <Button onClick={() => openStatusDialog("activate")}>Activate Project</Button>
          )}
          {isGM && project.status === "Active" && (
            <Button onClick={() => openStatusDialog("complete")}>Mark as Completed</Button>
          )}
          {isGM && !isClosed && (
            <Button variant="danger" onClick={() => openStatusDialog("cancel")}>Cancel Project</Button>
          )}
        </div>
      </div>

      {project.status === "Draft" && (
        <Banner tone="info" title="Draft: planning and procurement stage">
          The Project Manager can already plan milestones and tasks. Material requests and purchases start
          once a General Manager activates the project{hasSiteManager ? "." : " (a Site Manager must be assigned first)."}
        </Banner>
      )}
      {project.status === "Cancelled" && (
        <Banner tone="warning" title="This project was cancelled">
          {project.cancellationreason}
          {project.cancelledat ? ` (${DATETIME.format(new Date(project.cancelledat))})` : ""}
        </Banner>
      )}
      {(project.warnings || []).map((w) => (
        <Banner key={w.code} tone="warning" title={w.message} />
      ))}

      {project.description && (
        <Card className="project-detail-description"><p>{project.description}</p></Card>
      )}

      <div className="project-detail-facts">
        <Fact label="Budget" value={PESO.format(project.budget)} />
        <Fact label="Expenses Logged" value={PESO.format(totalExpenses)} note={`${budgetUsedPct}% of budget`} />
        <Fact label="Target Date of Development" value={formatDate(project.startdate)} note="Planning and procurement" />
        <Fact label="Target Date of Construction" value={formatDate(project.constructionstartdate)} />
        <Fact label="Target Date of Completion" value={formatDate(project.enddate)} />
        {project.actualcompletiondate && (
          <Fact label="Actual Completion / Turnover" value={formatDate(project.actualcompletiondate)} />
        )}
        <Fact label="Project Type" value={project.projecttype || "Not set"} />
        <Fact
          label="Location"
          value={project.municipality || "Not set"}
          note={[project.siteaddress, project.province].filter(Boolean).join(", ") || undefined}
        />
        <Fact label="Project Manager" value={project.projectmanagername || "Not assigned"} />
        <Fact label="Overall Progress" value={`${Number(project.progress || 0)}%`} />
      </div>

      <Card className="project-detail-assignment">
        <div>
          <p className="project-detail-fact-label">Current Site Manager</p>
          <p className="project-detail-assignment-name">
            {project.sitemanagername || "No Site Manager assigned"}
          </p>
          {project.sitemanageremail && (
            <p className="project-detail-fact-note">{project.sitemanageremail}</p>
          )}
        </div>
        {canManageSiteManager && (
          <div className="project-detail-assignment-control">
            <ManagerPicker
              label="Assign or replace Site Manager"
              managers={siteManagers}
              loading={false}
              value={project.sitemanagerid || ""}
              currentId={project.sitemanagerid}
              emptyOptionLabel="No Site Manager"
              disabled={siteManagerSaving || siteManagers.length === 0}
              onChange={handleSiteManagerChange}
            />
            {siteManagerSaving && <p className="project-detail-assignment-status">Updating assignment…</p>}
            {siteManagersError && <p className="field-error">{siteManagersError}</p>}
          </div>
        )}
      </Card>

      <div className="project-detail-milestones">
        <div className="spread project-detail-section-head">
          <h2>Milestones</h2>
          {canManage && (
            <Link to={`/projects/${project.projectid}/milestones/new`} className="btn btn-primary">
              Add Milestone
            </Link>
          )}
        </div>

        {!hasSiteManager && canManage && (
          <Banner tone="info" title="No Site Manager assigned">
            You can still add milestones, but tasks can't be created until a Site Manager is
            assigned to this project.
          </Banner>
        )}

        {project.milestones.length === 0 ? (
          <Banner tone="empty" title="No milestones yet">
            {canManage
              ? "Break this project down by adding its first milestone."
              : "The Project Manager hasn't added any milestones yet."}
          </Banner>
        ) : (
          <div className="project-detail-milestone-grid">
            {project.milestones.map((milestone) => (
              <MilestoneCard
                key={milestone.milestoneid}
                milestone={milestone}
                projectId={project.projectid}
                canManage={canManage}
                hasSiteManager={hasSiteManager}
              />
            ))}
          </div>
        )}
      </div>

      <div className="spread project-detail-section-head">
        <h2>Expenses</h2>
      </div>

      {expensesError && <Banner tone="error" title={expensesError} />}
      {actionError && !rejecting && <Banner tone="error" title={actionError} />}
      {!expensesError && expensesLoading && <p className="dashboard-loading">Loading expenses…</p>}
      {!expensesError && !expensesLoading && expenses.length === 0 && (
        <Banner tone="empty" title="No expenses recorded yet">
          Expenses submitted by the Purchaser for this project will appear here.
        </Banner>
      )}
      {!expensesError && !expensesLoading && expenses.length > 0 && (
        <Card className="users-table-card">
          <div className="table-scroll">
            <table className="users-table project-detail-table">
              <thead>
                <tr><th>Vendor</th><th>Category</th><th>Amount</th><th>Date</th><th>Status</th></tr>
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
                        <td>{e.category}</td>
                        <td>{PESO.format(e.amount)}</td>
                        <td>{DATE.format(new Date(e.receiptdate))}</td>
                        <td>
                          <span className="project-detail-badges">
                            <Badge status={e.status} />
                            {e.status === "Approved" && e.blockchainstatus === "TamperDetected" && (
                              <Badge status="Overdue">Changed after approval</Badge>
                            )}
                          </span>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="project-detail-expense-detail">
                          <td colSpan={5}>
                            <div className="expense-detail-grid">
                              <p><strong>Submitted by:</strong> {e.submittedbyname}</p>
                              <p><strong>Quantity:</strong> {e.quantity}</p>
                              <p><strong>TIN:</strong> {e.tin || "—"}</p>
                              <p><strong>BIR Permit:</strong> {e.birpermitnumber || "—"}</p>
                            </div>
                            {e.lineitems && (
                              <ul className="expense-detail-items">
                                {(typeof e.lineitems === "string" ? JSON.parse(e.lineitems) : e.lineitems).map((li, i) => (
                                  <li key={i}>{li.description} — {PESO.format(li.amount)}</li>
                                ))}
                              </ul>
                            )}
                            {e.receiptimageurl && (
                              <a href={e.receiptimageurl} target="_blank" rel="noreferrer">View receipt image</a>
                            )}

                            {e.submittedby === user.id && user.role === "General Manager" && (
                              <Banner tone="warning" title="You are reviewing your own submission">
                                Your approval will be recorded under your account.
                              </Banner>
                            )}

                            {canReview && e.status === "Pending" && (
                              e.submittedby === user.id && user.role !== "General Manager" ? (
                                <p>You submitted this expense, so someone else must review it.</p>
                              ) : (
                                <div className="expense-detail-actions">
                                  <Button onClick={() => handleApprove(e.expenseid)}>Approve</Button>
                                  {!(e.submittedby === user.id && user.role === "General Manager") && (
                                    <Button variant="danger" onClick={() => openReject(e)}>Reject</Button>
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
        <div className="record-protection-head">
          <span className="record-protection-seal" aria-hidden="true"><ShieldCheckIcon size={22} /></span>
          <div>
            <h2 id="record-protection-title">Record Protection</h2>
            <p className="record-protection-intro">
              When an expense is approved, a tamper-proof copy is saved on three separate servers.
              If anyone edits the expense afterwards, the system notices and raises an alert.
            </p>
          </div>
        </div>

          {chainError && <Banner tone="error" title={chainError} />}
          {!chainError && chainLoading && <p className="dashboard-loading">Loading blockchain audit data…</p>}
          {!chainError && !chainLoading && chainSummary && (
            chainSummary.logs.length === 0 ? (
              <Banner tone="empty" title="No blockchain records yet">
                Records appear here once an approved expense is confirmed on the blockchain.
              </Banner>
            ) : (
              <Card className="users-table-card">
                <div className="table-scroll">
                  <table className="users-table project-detail-table">
                    <thead>
                      <tr><th>Transaction Hash</th><th>Block #</th><th>Validators</th><th>Recorded</th></tr>
                    </thead>
                    <tbody>
                      {chainSummary.logs.map((log) => (
                        <tr key={log.txhash}>
                          <td title={log.txhash}>{log.txhash.slice(0, 20)}…</td>
                          <td>{log.blocknumber}</td>
                          <td>{log.validatornodecount}</td>
                          <td>{DATETIME.format(new Date(log.timestamp))}</td>
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
                <h2 id="project-status-title" className="modal-title">Activate this project?</h2>
                <p className="modal-body">
                  The Project Manager, Site Manager and Purchaser will be notified, and material requests and
                  purchases can begin.
                </p>
              </>
            )}
            {statusDialog.kind === "complete" && (
              <>
                <h2 id="project-status-title" className="modal-title">Mark this project as completed?</h2>
                <Field
                  label="Actual completion / turnover date"
                  required
                  type="date"
                  value={statusInput}
                  onChange={(ev) => setStatusInput(ev.target.value)}
                />
              </>
            )}
            {statusDialog.kind === "cancel" && (
              <>
                <h2 id="project-status-title" className="modal-title">Cancel this project?</h2>
                <p className="modal-body">Use this when the project didn't push through. It can't be reopened.</p>
                <Field
                  label="Reason"
                  required
                  as="textarea"
                  placeholder="e.g. Client did not push through"
                  value={statusInput}
                  onChange={(ev) => setStatusInput(ev.target.value)}
                />
              </>
            )}
            {statusError && <Banner tone="error" title={statusError} />}
            <div className="modal-actions">
              <Button variant="secondary" onClick={closeStatusDialog} disabled={statusBusy}>Back</Button>
              <Button
                variant={statusDialog.kind === "cancel" ? "danger" : "primary"}
                onClick={handleStatusAction}
                disabled={statusBusy || (statusDialog.kind !== "activate" && !statusInput.trim())}
              >
                {statusBusy ? "Saving…" : statusDialog.kind === "activate" ? "Activate" : statusDialog.kind === "complete" ? "Mark Completed" : "Cancel Project"}
              </Button>
            </div>
          </div>
        </div>
      )}
      {rejecting && (
        <div className="modal-overlay" role="presentation" onClick={closeReject}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="project-reject-title" onClick={(ev) => ev.stopPropagation()}>
            <h2 id="project-reject-title" className="modal-title">Reject this expense?</h2>
            <p className="modal-body">
              <strong>{rejecting.vendorname}</strong> · {PESO.format(rejecting.amount)}. The submitter will see it as rejected. No blockchain record is written.
            </p>
            <Field
              label="Reason for rejection"
              required
              as="textarea"
              placeholder="Tell the submitter what needs to change"
              value={rejectReason}
              onChange={(ev) => setRejectReason(ev.target.value)}
            />
            {actionError && <Banner tone="error" title={actionError} />}
            <div className="modal-actions">
              <Button variant="secondary" onClick={closeReject} disabled={rejectBusy}>Cancel</Button>
              <Button variant="danger" onClick={handleReject} disabled={rejectBusy || !rejectReason.trim()}>
                {rejectBusy ? "Saving…" : "Reject"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, note }) {
  return (
    <Card className="project-detail-fact">
      <p className="project-detail-fact-label">{label}</p>
      <p className="project-detail-fact-value">{value}</p>
      {note && <p className="project-detail-fact-note">{note}</p>}
    </Card>
  );
}
