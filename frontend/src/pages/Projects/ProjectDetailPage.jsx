import { Fragment, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getProjectOverview } from "../../api/projectsApi";
import { listExpenses, approveExpense, rejectExpense } from "../../api/expensesApi";
import { getProjectBlockchainSummary, verifyExpense } from "../../api/blockchainApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { MilestoneCard } from "../../components/milestones/MilestoneCard";
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

  const [chainSummary, setChainSummary] = useState(null);
  const [chainError, setChainError] = useState("");
  const [chainLoading, setChainLoading] = useState(true);
  const [verifyResults, setVerifyResults] = useState({}); // { [expenseId]: result }
  const [verifyingId, setVerifyingId] = useState(null);

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

  async function handleAction(expenseId, action) {
    setActionError("");
    try {
      await (action === "approve" ? approveExpense(expenseId) : rejectExpense(expenseId));
      setExpenses(await listExpenses(id));
      setChainSummary(await getProjectBlockchainSummary(id));
    } catch (err) {
      setActionError(extractErrorMessage(err, `Couldn't ${action} this expense.`));
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
        [expenseId]: { verified: false, message: extractErrorMessage(err, "Verification failed.") },
      }));
    } finally {
      setVerifyingId(null);
    }
  }

  if (loading) return <p className="dashboard-loading">Loading project…</p>;

  if (accessDenied) {
    return (
      <Banner tone="info" title="You don't manage this project">
        Only this project's assigned Project Manager or a General Manager can view its details.
      </Banner>
    );
  }
  if (error) return <Banner tone="error" title={error} />;
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
      <Link to="/projects" className="project-detail-back">Back to Projects</Link>

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
      {actionError && <Banner tone="error" title={actionError} />}
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
                        <td><Badge status={e.status} /></td>
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

                            {canReview && e.status === "Pending" && (
                              <div className="expense-detail-actions">
                                <Button onClick={() => handleAction(e.expenseid, "approve")}>Approve</Button>
                                <Button variant="danger" onClick={() => handleAction(e.expenseid, "reject")}>Reject</Button>
                              </div>
                            )}

                            {canVerify && e.status === "Approved" && (
                              <div className="expense-blockchain-row">
                                <span className={`chain-status chain-status-${(e.blockchainstatus || "none").toLowerCase()}`}>
                                  Blockchain: {e.blockchainstatus || "None"}
                                </span>
                                {e.blockchainstatus === "Confirmed" && (
                                  <Button
                                    variant="secondary"
                                    disabled={verifyingId === e.expenseid}
                                    onClick={() => handleVerify(e.expenseid)}
                                  >
                                    {verifyingId === e.expenseid ? "Verifying…" : "Verify on Blockchain"}
                                  </Button>
                                )}
                                {verifyResult && (
                                  verifyResult.verified ? (
                                    <Banner tone="info" title="Verified: matches blockchain record">
                                      Tx: {verifyResult.txHash?.slice(0, 18)}… · Block #{verifyResult.blockNumber}
                                    </Banner>
                                  ) : (
                                    <Banner tone="error" title="Tamper alert">
                                      {verifyResult.message}
                                    </Banner>
                                  )
                                )}
                              </div>
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

      <div className="spread project-detail-section-head">
        <h2>Blockchain Audit Trail</h2>
      </div>

      {chainError && <Banner tone="error" title={chainError} />}
      {!chainError && chainLoading && <p className="dashboard-loading">Loading blockchain audit data…</p>}
      {!chainError && !chainLoading && chainSummary && (
        <>
          {chainSummary.openAlerts.length > 0 && (
            <Banner tone="error" title={`${chainSummary.openAlerts.length} unresolved tamper alert(s) on this project`}>
              At least one expense's on-chain hash no longer matches its database record. Contact your System Administrator.
            </Banner>
          )}

          <div className="project-detail-facts chain-summary-facts">
            <Fact label="Confirmed on Blockchain" value={chainSummary.confirmedCount} />
            <Fact
              label="Last Recorded"
              value={chainSummary.lastCheckedAt ? DATETIME.format(new Date(chainSummary.lastCheckedAt)) : "No records yet"}
            />
          </div>

          {chainSummary.logs.length === 0 ? (
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
          )}
        </>
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
