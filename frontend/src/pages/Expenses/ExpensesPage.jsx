import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  listExpenses,
  listFlaggedExpenses,
  approveExpense,
  rejectExpense,
} from "../../api/expensesApi";
import { listProjects } from "../../api/projectsApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { ExpenseProtection } from "../../components/blockchain/ExpenseProtection";
import { flagLabel } from "../../utils/plainLanguage";
import { FlagReviewPanel, SplitSiblings } from "./FlagReviewPanel";
import { useLocale } from "../../i18n/LocaleProvider";
import "./ExpensesPage.css";
import { verifyExpense } from "../../api/blockchainApi";

// Always two decimals, so amounts line up in a column and centavos on a receipt are never rounded away.
const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS_TABS = ["All", "Pending", "Flagged", "Approved", "Rejected"];
const PAGE_SIZE = 10;

/** Line items arrive as JSON text or an array; a bad value shows no lines instead of breaking the page. */
function parseLineItems(value) {
  if (!value) return [];
  if (typeof value !== "string") return Array.isArray(value) ? value : [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const SUBMITTED_AT = { hour: "numeric", minute: "2-digit" };

/** Who submitted: the username (without the ".Role" tail the account label carries) and the role. */
function submitterOf(e) {
  const role = e.submittedbyrole || "";
  let name = e.submittedbyname || "";
  if (role && name.endsWith(`.${role}`)) name = name.slice(0, -(role.length + 1));
  return { name: name || "—", role };
}

/**
 * Render the GM/PM expense review queue with status filters and review actions.
 * The backend scopes PM results to their projects; the client also filters them.
 */
// The one-line explanation shown under each status tab.
const HINT_KEYS = {
  All: "expenses.hint_all",
  Pending: "expenses.hint_pending",
  Flagged: "expenses.hint_flagged",
  Approved: "expenses.hint_approved",
  Rejected: "expenses.hint_rejected",
};

// Small line icons for the expanded expense row. They stay hidden until the General Manager
// skin turns them on (see styles/gm-skin.css), so other roles keep the plain layout.
const DETAIL_ICON_PATHS = {
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  box: <><path d="m21 8-9-5-9 5 9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8M12 13v8" /></>,
  shield: <><path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
  note: <><path d="M5 4h14v12l-4 4H5V4Z" /><path d="M15 20v-4h4M8 9h8M8 13h4" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  check: <path d="m5 12 5 5 9-10" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
};

function DetailIcon({ name }) {
  return (
    <svg className="expenses-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {DETAIL_ICON_PATHS[name]}
    </svg>
  );
}

function DetailRow({ icon, label, children }) {
  return (
    <p className="expenses-detail-row">
      <DetailIcon name={icon} />
      <span className="expenses-detail-text"><strong>{label}</strong> {children}</span>
    </p>
  );
}

export function ExpensesPage() {
  const { user } = useAuth();
  const { t, tv, formatDate } = useLocale();
  const [expenses, setExpenses] = useState([]);
  const [flagged, setFlagged] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [tab, setTab] = useState(user.role === "Project Manager" ? "Flagged" : "Pending");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  // A notification can link to one expense (?focus=<id>): show just that one, opened, until "Show all".
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get("focus");

  const [confirm, setConfirm] = useState(null); // { expense, action }
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [verifyResults, setVerifyResults] = useState({});
  const [verifyingId, setVerifyingId] = useState(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [exp, proj, flg] = await Promise.all([
        listExpenses(),
        listProjects(),
        listFlaggedExpenses(),
      ]);
      setExpenses(exp);
      setProjects(proj);
      setFlagged(flg);
    } catch (err) {
      setError(extractErrorMessage(err, t("errors.load_expenses")));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (focusId) setOpenId(focusId);
  }, [focusId]);

  const projectById = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.projectid, p])),
    [projects]
  );

  // { [expenseid]: [{ flagType, reason }] }
  const flagMap = useMemo(
    () => Object.fromEntries(flagged.map((f) => [f.expenseid, f.flags])),
    [flagged]
  );
  // The full flagged row (project, request, split portions, matched duplicate) for the review panel.
  const flaggedById = useMemo(
    () => Object.fromEntries(flagged.map((f) => [f.expenseid, f])),
    [flagged]
  );

  const scoped = useMemo(() => {
    if (user.role !== "Project Manager") return expenses;
    return expenses.filter((e) => projectById[e.projectid]?.projectmanagerid === user.id);
  }, [expenses, projectById, user.role, user.id]);

  const counts = useMemo(() => {
    const c = { All: scoped.length, Pending: 0, Flagged: 0, Approved: 0, Rejected: 0 };
    scoped.forEach((e) => {
      if (c[e.status] != null) c[e.status] += 1;
      if (flagMap[e.expenseid]) c.Flagged += 1;
    });
    return c;
  }, [scoped, flagMap]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (focusId) return scoped.filter((e) => e.expenseid === focusId);
    return scoped
      .filter((e) => {
        if (tab === "All") return true;
        if (tab === "Flagged") return Boolean(flagMap[e.expenseid]);
        return e.status === tab;
      })
      .filter((e) => {
        if (!q) return true;
        return (
          (e.vendorname || "").toLowerCase().includes(q) ||
          (projectById[e.projectid]?.name || "").toLowerCase().includes(q) ||
          (e.submittedbyname || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(b.submittedat) - new Date(a.submittedat));
  }, [scoped, tab, search, projectById, flagMap, focusId]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const rows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const filteredTotal = filtered.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  function openConfirm(expense, action) {
    setActionError("");
    setReason("");
    setConfirm({ expense, action });
  }

  function closeConfirm() {
    setConfirm(null);
    setReason("");
  }

  async function handleVerify(expenseId) {
    setVerifyingId(expenseId);
    try {
      const result = await verifyExpense(expenseId);
      setVerifyResults((prev) => ({ ...prev, [expenseId]: result }));
    } catch (err) {
      setVerifyResults((prev) => ({
        ...prev,
        [expenseId]: { verified: false, error: extractErrorMessage(err, t("errors.verify_failed")) },
      }));
    } finally {
      setVerifyingId(null);
    }
  }

  async function handleConfirm() {
    if (!confirm) return;
    setBusy(true);
    setActionError("");
    try {
      let result;
      if (confirm.action === "approve") {
        result = await approveExpense(confirm.expense.expenseid);
      } else {
        result = await rejectExpense(confirm.expense.expenseid, reason.trim());
      }
      setNotice(result?.warning || "");
      closeConfirm();
      const [exp, flg] = await Promise.all([listExpenses(), listFlaggedExpenses()]);
      setExpenses(exp);
      setFlagged(flg);
    } catch (err) {
      setActionError(extractErrorMessage(err, t(confirm.action === "approve" ? "errors.expense_approve" : "errors.expense_reject")));
    } finally {
      setBusy(false);
    }
  }

  function selectTab(name) {
    setTab(name);
    setPage(1);
  }

  // One short line under the vendor: why a row needs attention, without opening it.
  function rowNote(e, flags) {
    if (e.status === "Rejected" && e.rejectionreason) return e.rejectionreason;
    if (flags?.length) return flagLabel(flags[0].flagType, tv);
    if (e.status === "Pending" && e.submitnote) return e.submitnote;
    return "";
  }

  // Which decisions a row offers without opening it (same rules as the open row below).
  function inlineActions(e) {
    if (e.status !== "Pending") return null;
    if (flagMap[e.expenseid]) return { review: true };
    if (e.submittedby === user.id) return user.role === "General Manager" ? { approve: true } : null;
    return { approve: true, reject: true };
  }
  // Decided over every page of the list, so the Actions column does not appear and disappear while paging.
  const showActions = filtered.some((e) => inlineActions(e));

  const rejectNeedsReason = confirm?.action === "reject" && !reason.trim();

  return (
    <div className="expenses-page">
      <div className="expenses-header spread">
        <div>
          <h1>
            {user.role === "Project Manager" ? t("expenses.pm_title") : t("nav.expenses")}
          </h1>
            <p className="expenses-subtitle">
              {user.role === "Project Manager" ? t("expenses.pm_subtitle") : t("expenses.gm_subtitle")}
            </p>
        </div>
        {/* One button: Submit expense. Split receipt is a tab on that page. */}
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <Link to="/expenses/new" className="btn btn-primary">
            {t("nav.submit_expense")}
          </Link>
        </div>
      </div>

      {error && <Banner tone="error" title={error} />}
      {notice && (
        <Banner tone="warning" title={t("expenses.approved_notice_title")}>
          {t("expenses.approved_notice_body")}
        </Banner>
      )}
      {actionError && !confirm && <Banner tone="error" title={actionError} />}
      {focusId && (
        <Banner
          tone="info"
          title={t("expenses.focus_title")}
          action={<Button variant="secondary" onClick={() => { setSearchParams({}); setOpenId(null); }}>{t("expenses.focus_show_all")}</Button>}
        >
          {t("expenses.focus_body")}
        </Banner>
      )}

      {!error && (
        <>
          <div className="expenses-toolbar">
            <div className="expenses-tabs" role="tablist">
              {STATUS_TABS.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={tab === name}
                  className={"expenses-tab" + (tab === name ? " expenses-tab-active" : "")}
                  onClick={() => selectTab(name)}
                >
                  {tv("status", name)} <span className="expenses-tab-count">{counts[name]}</span>
                </button>
              ))}
            </div>
            <input
              type="search"
              className="expenses-search"
              placeholder={t("expenses.search_placeholder")}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              aria-label={t("expenses.search_label")}
            />
          </div>

          {!focusId && <p className={"expenses-hint expenses-hint-" + tab.toLowerCase()}>{t(HINT_KEYS[tab])}</p>}

          {loading && <p className="dashboard-loading">{t("dashboard.loading_expenses")}</p>}

          {!loading && filtered.length === 0 && (
            <Banner tone="empty" title={search ? t("expenses.no_match") : tab === "All" ? t("expenses.none") : t("expenses.none_status", { status: tv("status", tab).toLowerCase() })}>
              {search ? t("expenses.try_different") : t("expenses.will_appear")}
            </Banner>
          )}

          {!loading && filtered.length > 0 && (
            <>
              <Card className="users-table-card">
                <div className="table-scroll">
                  <table className="users-table expenses-table">
                    <thead>
                      <tr>
                        <th>{t("dashboard.vendor")}</th>
                        <th>{t("nav.project")}</th>
                        <th>{t("dashboard.category")}</th>
                        <th>{t("dashboard.amount")}</th>
                        <th>{t("my_expenses.receipt_date")}</th>
                        <th>{t("expenses.col_submitted")}</th>
                        <th>{t("expenses.col_submitted_by")}</th>
                        <th>{t("dashboard.status")}</th>
                        {showActions && <th className="expenses-actions-col">{t("expenses.col_actions")}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((e) => {
                        const isOpen = openId === e.expenseid;
                        const project = projectById[e.projectid];
                        const flags = flagMap[e.expenseid];
                        const items = parseLineItems(e.lineitems);
                        return (
                          <Fragment key={e.expenseid}>
                            <tr
                              className={"expenses-row" + (isOpen ? " expenses-row-open" : "")}
                              onClick={() => setOpenId(isOpen ? null : e.expenseid)}
                            >
                              <td className="expenses-vendor" data-label={t("dashboard.vendor")}>
                                <span className="expenses-vendor-name">{e.vendorname}</span>
                                {rowNote(e, flags) && <span className="expenses-sub">{rowNote(e, flags)}</span>}
                              </td>
                              <td data-label={t("nav.project")}>{project?.name || "—"}</td>
                              <td data-label={t("dashboard.category")}>
                                {tv("category", e.category)}
                              </td>
                              <td data-label={t("dashboard.amount")}>{PESO.format(e.amount)}</td>
                              <td data-label={t("my_expenses.receipt_date")}>{formatDate(e.receiptdate)}</td>
                              <td className="expenses-when" data-label={t("expenses.col_submitted")}>
                                <span>{formatDate(e.submittedat)}</span>
                                <span className="expenses-when-time">{formatDate(e.submittedat, SUBMITTED_AT)}</span>
                              </td>
                              <td className="expenses-who" data-label={t("expenses.col_submitted_by")}>
                                <span>{submitterOf(e).name}</span>
                                {submitterOf(e).role && <span className="expenses-who-role">{submitterOf(e).role}</span>}
                              </td>
                              <td data-label={t("dashboard.status")}>
                                <span className="expenses-badges">
                                  <Badge status={e.status} />
                                  {flags && (
                                    <Badge status="Flagged">
                                      {flags.length === 1 ? t("expenses.flags_one") : t("expenses.flags_other", { count: flags.length })}
                                    </Badge>
                                  )}
                                  {e.status === "Approved" && e.blockchainstatus === "TamperDetected" && (
                                    <Badge status="Overdue">{t("chain.changed.label")}</Badge>
                                  )}
                                </span>
                              </td>
                              {showActions && (
                                <td className="expenses-actions-col" onClick={(ev) => ev.stopPropagation()}>
                                  {(() => {
                                    const a = inlineActions(e);
                                    if (!a) return null;
                                    return (
                                      <span className="expenses-quick">
                                        {a.review && (
                                          <button type="button" className="expenses-quick-btn expenses-quick-review" onClick={() => setOpenId(e.expenseid)}>
                                            {t("expenses.review")}
                                          </button>
                                        )}
                                        {a.approve && (
                                          <button type="button" className="expenses-quick-btn expenses-quick-approve" onClick={() => openConfirm(e, "approve")} aria-label={`${t("expenses.approve")}: ${e.vendorname}`} title={t("expenses.approve")}>
                                            <DetailIcon name="check" />
                                          </button>
                                        )}
                                        {a.reject && (
                                          <button type="button" className="expenses-quick-btn expenses-quick-reject" onClick={() => openConfirm(e, "reject")} aria-label={`${t("expenses.reject")}: ${e.vendorname}`} title={t("expenses.reject")}>
                                            <DetailIcon name="x" />
                                          </button>
                                        )}
                                      </span>
                                    );
                                  })()}
                                </td>
                              )}
                            </tr>
                            {isOpen && (
                              <tr className="expenses-detail">
                                <td colSpan={showActions ? 9 : 8}>
                                  {flags && (
                                    <FlagReviewPanel
                                      expense={flaggedById[e.expenseid] ?? e}
                                      flags={flags}
                                      showEffect={e.status === "Pending"}
                                    />
                                  )}
                                  {e.submitnote && (
                                    <Banner tone="warning" title={t("expenses.submit_note")}>
                                      {e.submitnote}
                                    </Banner>
                                  )}
                                  {e.submittedby === user.id && user.role === "General Manager" && (
                                    <Banner tone="warning" title={t("expenses.own_title")}>
                                      {t("expenses.own_body")}
                                    </Banner>
                                  )}
                                  <section className="exp-section">
                                  <h3 className="exp-section-title">{t("expenses.details_title")}</h3>
                                  <div className="expenses-detail-grid">
                                    <DetailRow icon="user" label={t("expenses.submitted_by")}>{e.submittedbyname}</DetailRow>
                                    {e.ticketsubject && <DetailRow icon="doc" label={t("expenses.request")}>{e.ticketsubject}</DetailRow>}
                                    <DetailRow icon="box" label={t("expenses.quantity")}>{e.quantity}</DetailRow>
                                    <DetailRow icon="shield" label={t("expenses.bir_status")}>{tv("bir", e.birvalidationstatus)}</DetailRow>
                                    <DetailRow icon="doc" label={t("expenses.tin")}>{e.tin || "—"}</DetailRow>
                                    <DetailRow icon="doc" label={t("expenses.bir_permit")}>{e.birpermitnumber || "—"}</DetailRow>
                                    <DetailRow icon="doc" label={t("expenses.or_si")}>{e.birnumber || "—"}</DetailRow>
                                    {e.status === "Rejected" && e.rejectionreason && (
                                      <DetailRow icon="note" label={t("expenses.rejection_reason")}>{e.rejectionreason}</DetailRow>
                                    )}
                                  </div>
                                  </section>
                                  {items.length > 0 && (
                                    <section className="exp-section">
                                      <h3 className="exp-section-title">{t("expenses.items_title")}</h3>
                                      <table className="exp-mini-table">
                                        <thead>
                                          <tr><th>{t("expenses.col_item")}</th><th className="exp-num">{t("dashboard.amount")}</th></tr>
                                        </thead>
                                        <tbody>
                                          {items.map((li, i) => (
                                            <tr key={i}><td>{li.description}</td><td className="exp-num">{PESO.format(li.amount)}</td></tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </section>
                                  )}
                                  {!flags && <SplitSiblings siblings={e.siblings} />}
                                  <div className="expenses-detail-links">
                                    {e.receiptimageurl && (
                                      <a href={e.receiptimageurl} target="_blank" rel="noreferrer"><DetailIcon name="doc" />{t("expenses.view_receipt")}</a>
                                    )}
                                    {project && <Link to={`/projects/${project.projectid}`}><DetailIcon name="folder" />{t("expenses.open_project")}</Link>}
                                  </div>
                                  {e.status === "Pending" && (
                                    <div className="expenses-actions">
                                      {e.submittedby === user.id ? (
                                        user.role === "General Manager" ? (
                                          <Button onClick={() => openConfirm(e, "approve")}><DetailIcon name="check" />{t("expenses.approve")}</Button>
                                        ) : (
                                        <p className="expenses-subtitle">
                                          {t("expenses.own_waiting")}
                                        </p>
                                        )
                                      ) : (
                                        <>
                                          <Button onClick={() => openConfirm(e, "approve")}><DetailIcon name="check" />{t("expenses.approve")}</Button>
                                          <Button variant="danger" onClick={() => openConfirm(e, "reject")}><DetailIcon name="x" />{t("expenses.reject")}</Button>
                                        </>
                                      )}
                                    </div>
                                  )}
                                  
                                  {e.status === "Approved" && (
                                    <ExpenseProtection
                                      status={e.blockchainstatus}
                                      canCheck={user.role === "General Manager"}
                                      checking={verifyingId === e.expenseid}
                                      result={verifyResults[e.expenseid]}
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

              <div className="expenses-footer">
                <span className="expenses-total">
                  {filtered.length === 1 ? t("expenses.count_one") : t("expenses.count_other", { count: filtered.length })} · {PESO.format(filteredTotal)}
                </span>
                {totalPages > 1 && (
                  <div className="expenses-pagination">
                    <button type="button" className="expenses-page-btn" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>{t("common.previous")}</button>
                    <span>{t("common.page_of", { page: currentPage, total: totalPages })}</span>
                    <button type="button" className="expenses-page-btn" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>{t("common.next")}</button>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {confirm && (
        <div className="modal-overlay" role="presentation" onClick={() => !busy && closeConfirm()}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="expense-confirm-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="expense-confirm-title" className="modal-title">
              {confirm.action === "approve" ? t("expenses.confirm_approve_title") : t("expenses.confirm_reject_title")}
            </h2>
            <p className="modal-body">
              <strong>{confirm.expense.vendorname}</strong> · {PESO.format(confirm.expense.amount)}.{" "}
              {confirm.action === "approve"
                ? t("expenses.confirm_approve_body")
                : t("expenses.confirm_reject_body")}
            </p>
            {confirm.expense.submitnote && (
              <Banner tone="warning" title={t("expenses.submit_note")}>
                {confirm.expense.submitnote}
              </Banner>
            )}
            {flagMap[confirm.expense.expenseid] && (
              <Banner tone="warning" title={t("expenses.flagged_title")}>
                <ul className="expenses-flag-list">
                  {flagMap[confirm.expense.expenseid].map((f, i) => (
                    <li key={i}>{flagLabel(f.flagType, tv)}</li>
                  ))}
                </ul>
              </Banner>
            )}
            {confirm.action === "reject" && (
              <Field
                label={t("expenses.reason_label")}
                required
                as="textarea"
                placeholder={t("expenses.reason_placeholder")}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
            {actionError && <Banner tone="error" title={actionError} />}
            <div className="modal-actions">
              <Button variant="secondary" onClick={closeConfirm} disabled={busy}>{t("common.cancel")}</Button>
              <Button
                variant={confirm.action === "approve" ? "primary" : "danger"}
                onClick={handleConfirm}
                disabled={busy || rejectNeedsReason}
              >
                {busy ? t("common.saving") : confirm.action === "approve" ? t("expenses.approve") : t("expenses.reject")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
