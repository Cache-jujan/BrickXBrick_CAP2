import { Fragment, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getEligibleSiteManagers, getProjectOverview, updateProjectSiteManager } from "../../api/projectsApi";
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
import { BackLink } from "../../components/ui/BackLink";
import { ChainStatus } from "../../components/blockchain/ChainStatus";
import { ExpenseProtection } from "../../components/blockchain/ExpenseProtection";
import { ShieldCheckIcon } from "../../components/ui/icons";
import "./ProjectDetailPage.css";

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
const DATE = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "long", day: "numeric" });
const DATETIME = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

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

  const canManageSiteManager = Boolean(
    project && (
      user.role === "General Manager" ||
      (user.role === "Project Manager" && project.projectmanagerid === user.id)
    )
  );

  useEffect(() => {
    if (!canManageSiteManager) return undefined;
    let cancelled = false;
    setSiteManagersError("");
    getEligibleSiteManagers()
      .then((data) => { if (!cancelled) setSiteManagers(data); })
      .catch((err) => {
        if (!cancelled) setSiteManagersError(extractErrorMessage(err, "Couldn't load Site Managers."));
      });
    return () => { cancelled = true; };
  }, [canManageSiteManager]);

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

  async function handleSiteManagerChange(event) {
    const siteManagerId = event.target.value || null;
    setSiteManagerSaving(true);
    setSiteManagersError("");
    try {
      const updated = await updateProjectSiteManager(id, siteManagerId);
      setProject((previous) => ({ ...previous, ...updated }));
    } catch (err) {
      setSiteManagersError(extractErrorMessage(err, "Couldn't update the Site Manager assignment."));
    } finally {
      setSiteManagerSaving(false);
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
  const canManage = user.role === "Project Manager" && project.projectmanagerid === user.id;
  const hasSiteManager = Boolean(project.sitemanagerid);

  return (
    <div className="project-detail">
      <BackLink to="/projects">Back to Projects</BackLink>

      <div className="spread project-detail-header">
        <div>
          <h1>{project.name}</h1>
          <p className="project-detail-client">{project.clientname}</p>
        </div>
        <Badge status={project.status} />
      </div>

      {project.description && (
        <Card className="project-detail-description"><p>{project.description}</p></Card>
      )}

      <div className="project-detail-facts">
        <Fact label="Budget" value={PESO.format(project.budget)} />
        <Fact label="Expenses Logged" value={PESO.format(totalExpenses)} note={`${budgetUsedPct}% of budget`} />
        <Fact label="Start Date" value={DATE.format(new Date(project.startdate))} />
        <Fact
          label="Expected End Date"
          value={project.enddate ? DATE.format(new Date(project.enddate)) : "Not set"}
        />
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
            <Field
              label="Assign or replace Site Manager"
              as="select"
              value={project.sitemanagerid || ""}
              disabled={siteManagerSaving || siteManagers.length === 0}
              onChange={handleSiteManagerChange}
            >
              <option value="">No Site Manager</option>
              {siteManagers.map((manager) => (
                <option key={manager.userid} value={manager.userid}>
                  {manager.name.trim()} ({manager.email})
                </option>
              ))}
            </Field>
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
