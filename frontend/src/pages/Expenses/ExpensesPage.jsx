import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listExpenses, approveExpense, rejectExpense } from "../../api/expensesApi";
import { listProjects } from "../../api/projectsApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import "./ExpensesPage.css";

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
const DATE = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric" });
const STATUS_TABS = ["All", "Pending", "Approved", "Rejected"];
const PAGE_SIZE = 10;

// Expense review queue for GM and PM.
// NOTE: GET /api/expenses returns every project's expenses to any GM/PM,
// and PATCH approve/reject has no project-ownership check. The list below
// hides other PMs' projects in the UI only; the backend should enforce it.
export function ExpensesPage() {
  const { user } = useAuth();
  const [expenses, setExpenses] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [tab, setTab] = useState("Pending");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);

  const [confirm, setConfirm] = useState(null); // { expense, action }
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [exp, proj] = await Promise.all([listExpenses(), listProjects()]);
      setExpenses(exp);
      setProjects(proj);
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't load expenses."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const projectById = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.projectid, p])),
    [projects]
  );

  const scoped = useMemo(() => {
    if (user.role !== "Project Manager") return expenses;
    return expenses.filter((e) => projectById[e.projectid]?.projectmanagerid === user.id);
  }, [expenses, projectById, user.role, user.id]);

  const counts = useMemo(() => {
    const c = { All: scoped.length, Pending: 0, Approved: 0, Rejected: 0 };
    scoped.forEach((e) => { if (c[e.status] != null) c[e.status] += 1; });
    return c;
  }, [scoped]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped
      .filter((e) => tab === "All" || e.status === tab)
      .filter((e) => {
        if (!q) return true;
        return (
          (e.vendorname || "").toLowerCase().includes(q) ||
          (projectById[e.projectid]?.name || "").toLowerCase().includes(q) ||
          (e.submittedbyname || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(b.submittedat) - new Date(a.submittedat));
  }, [scoped, tab, search, projectById]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const rows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const filteredTotal = filtered.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  async function handleConfirm() {
    if (!confirm) return;
    setBusy(true);
    setActionError("");
    try {
      const fn = confirm.action === "approve" ? approveExpense : rejectExpense;
      const result = await fn(confirm.expense.expenseid);
      setNotice(result?.warning || "");
      setConfirm(null);
      setExpenses(await listExpenses());
    } catch (err) {
      setActionError(extractErrorMessage(err, `Couldn't ${confirm.action} this expense.`));
    } finally {
      setBusy(false);
    }
  }

  function selectTab(t) {
    setTab(t);
    setPage(1);
  }

  return (
    <div className="expenses-page">
      <div className="expenses-header">
        <h1>Expenses</h1>
        <p className="expenses-subtitle">
          Review expenses submitted by Purchasers. Approving an expense records its hash on the blockchain.
        </p>
      </div>

      {error && <Banner tone="error" title={error} />}
      {notice && <Banner tone="warning" title="Approved, blockchain record deferred">{notice}</Banner>}
      {actionError && !confirm && <Banner tone="error" title={actionError} />}

      {!error && (
        <>
          <div className="expenses-toolbar">
            <div className="expenses-tabs" role="tablist">
              {STATUS_TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  className={"expenses-tab" + (tab === t ? " expenses-tab-active" : "")}
                  onClick={() => selectTab(t)}
                >
                  {t} <span className="expenses-tab-count">{counts[t]}</span>
                </button>
              ))}
            </div>
            <input
              type="search"
              className="expenses-search"
              placeholder="Search vendor, project or submitter"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              aria-label="Search expenses"
            />
          </div>

          {loading && <p className="dashboard-loading">Loading expenses…</p>}

          {!loading && filtered.length === 0 && (
            <Banner tone="empty" title={search ? "No expenses match your search" : `No ${tab === "All" ? "" : tab.toLowerCase() + " "}expenses`}>
              {search ? "Try a different vendor, project or name." : "Submitted expenses will appear here."}
            </Banner>
          )}

          {!loading && filtered.length > 0 && (
            <>
              <Card className="users-table-card">
                <div className="table-scroll">
                  <table className="users-table expenses-table">
                    <thead>
                      <tr>
                        <th>Vendor</th>
                        <th>Project</th>
                        <th>Category</th>
                        <th>Amount</th>
                        <th>Date</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((e) => {
                        const isOpen = openId === e.expenseid;
                        const project = projectById[e.projectid];
                        const items = e.lineitems
                          ? typeof e.lineitems === "string" ? JSON.parse(e.lineitems) : e.lineitems
                          : [];
                        return (
                          <Fragment key={e.expenseid}>
                            <tr
                              className={"expenses-row" + (isOpen ? " expenses-row-open" : "")}
                              onClick={() => setOpenId(isOpen ? null : e.expenseid)}
                            >
                              <td>{e.vendorname}</td>
                              <td>{project?.name || "—"}</td>
                              <td>{e.category}</td>
                              <td>{PESO.format(e.amount)}</td>
                              <td>{DATE.format(new Date(e.receiptdate))}</td>
                              <td><Badge status={e.status} /></td>
                            </tr>
                            {isOpen && (
                              <tr className="expenses-detail">
                                <td colSpan={6}>
                                  <div className="expenses-detail-grid">
                                    <p><strong>Submitted by:</strong> {e.submittedbyname}</p>
                                    <p><strong>Quantity:</strong> {e.quantity}</p>
                                    <p><strong>BIR status:</strong> {e.birvalidationstatus}</p>
                                    <p><strong>TIN:</strong> {e.tin || "—"}</p>
                                    <p><strong>BIR permit:</strong> {e.birpermitnumber || "—"}</p>
                                    <p><strong>OR/SI number:</strong> {e.birnumber || "—"}</p>
                                    {e.status === "Approved" && (
                                      <p><strong>Blockchain:</strong> {e.blockchainstatus || "None"}</p>
                                    )}
                                  </div>
                                  {items.length > 0 && (
                                    <ul className="expenses-items">
                                      {items.map((li, i) => (
                                        <li key={i}>{li.description} — {PESO.format(li.amount)}</li>
                                      ))}
                                    </ul>
                                  )}
                                  <div className="expenses-detail-links">
                                    {e.receiptimageurl && (
                                      <a href={e.receiptimageurl} target="_blank" rel="noreferrer">View receipt image</a>
                                    )}
                                    {project && <Link to={`/projects/${project.projectid}`}>Open project</Link>}
                                  </div>
                                  {e.status === "Pending" && (
                                    <div className="expenses-actions">
                                      <Button onClick={() => { setActionError(""); setConfirm({ expense: e, action: "approve" }); }}>Approve</Button>
                                      <Button variant="danger" onClick={() => { setActionError(""); setConfirm({ expense: e, action: "reject" }); }}>Reject</Button>
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

              <div className="expenses-footer">
                <span className="expenses-total">
                  {filtered.length} {filtered.length === 1 ? "expense" : "expenses"} · {PESO.format(filteredTotal)}
                </span>
                {totalPages > 1 && (
                  <div className="expenses-pagination">
                    <button type="button" className="expenses-page-btn" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
                    <span>Page {currentPage} of {totalPages}</span>
                    <button type="button" className="expenses-page-btn" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>Next</button>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {confirm && (
        <div className="modal-overlay" role="presentation" onClick={() => !busy && setConfirm(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="expense-confirm-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="expense-confirm-title" className="modal-title">
              {confirm.action === "approve" ? "Approve this expense?" : "Reject this expense?"}
            </h2>
            <p className="modal-body">
              <strong>{confirm.expense.vendorname}</strong> · {PESO.format(confirm.expense.amount)}.{" "}
              {confirm.action === "approve"
                ? "Its hash will be recorded on the blockchain and can't be undone."
                : "The Purchaser will see it as rejected. No blockchain record is written."}
            </p>
            {actionError && <Banner tone="error" title={actionError} />}
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
              <Button variant={confirm.action === "approve" ? "primary" : "danger"} onClick={handleConfirm} disabled={busy}>
                {busy ? "Saving…" : confirm.action === "approve" ? "Approve" : "Reject"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
