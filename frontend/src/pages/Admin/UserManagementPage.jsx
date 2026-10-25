import { useEffect, useMemo, useState } from "react";
import {
  listUsers,
  createUser,
  updateUser,
  deactivateUser,
  unlockUser,
  sendPasswordEmail,
  VALID_ROLES,
} from "../../api/adminApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Banner } from "../../components/ui/Banner";
import { useLocale } from "../../i18n/LocaleProvider";
import "./UserManagementPage.css";

const DATETIME_OPTIONS = { dateStyle: "medium", timeStyle: "short" };

export function UserManagementPage() {
  const { user: me } = useAuth();
  const { t, tv, formatDate } = useLocale();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  // { type: "password" | "role" | "deactivate" | "reactivate", user }
  const [dialog, setDialog] = useState(null);
  const [rowError, setRowError] = useState("");

  async function reload() {
    setLoading(true);
    setListError("");
    try {
      setUsers(await listUsers());
    } catch (err) {
      setListError(extractErrorMessage(err, t("errors.load_users")));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once; a language change must not refetch
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "All" && u.role !== roleFilter) return false;
      if (statusFilter !== "All" && u.status !== statusFilter) return false;
      if (!q) return true;
      return (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q);
    });
  }, [users, search, roleFilter, statusFilter]);

  async function handleUnlock(u) {
    setRowError("");
    try {
      await unlockUser(u.userid);
      reload();
    } catch (err) {
      setRowError(extractErrorMessage(err, t("errors.unlock")));
    }
  }

  return (
    <div className="users-page">
      <div className="spread users-header">
        <div>
          <h1>{t("nav.user_accounts")}</h1>
          <p className="users-subtitle">{t("users.subtitle")}</p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? t("common.cancel") : t("users.add")}
        </Button>
      </div>

      {showForm && (
        <CreateUserForm
          onCreated={(email) => {
            setShowForm(false);
            setNotice(t("users.invite_sent", { email }));
            reload();
          }}
        />
      )}
      {notice && <Banner tone="info" title={notice} />}

      <div className="users-toolbar">
        <input
          type="search"
          className="users-search"
          placeholder={t("users.search_ph")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t("users.search_label")}
        />
        <select className="users-filter" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label={t("users.filter_role")}>
          <option value="All">{t("users.all_roles")}</option>
          {VALID_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="users-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t("projects.filter_status")}>
          <option value="All">{t("users.all_statuses")}</option>
          <option value="Active">{tv("status", "Active")}</option>
          <option value="Inactive">{tv("status", "Inactive")}</option>
        </select>
      </div>

      {listError && <Banner tone="error" title={listError} />}
      {rowError && <Banner tone="error" title={rowError} />}
      {!listError && loading && <p className="dashboard-loading">{t("users.loading")}</p>}

      {!listError && !loading && (
        <Card className="users-table-card">
          {visible.length === 0 ? (
            <div className="users-empty">
              <Banner tone="empty" title={users.length === 0 ? t("users.none") : t("users.no_match")}>
                {users.length === 0 ? t("users.add_first") : t("users.try_filter")}
              </Banner>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="users-table">
                <thead>
                  <tr>
                    <th>{t("users.name")}</th>
                    <th>{t("users.email")}</th>
                    <th>{t("settings.role")}</th>
                    <th>{t("dashboard.status")}</th>
                    <th>{t("users.lockout")}</th>
                    <th aria-label={t("tamper.actions")} />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((u) => {
                    const isSelf = u.userid === me.id;
                    const isLocked = u.lockoutuntil && new Date(u.lockoutuntil) > new Date();
                    return (
                      <tr key={u.userid}>
                        <td>{u.name}{isSelf && <span className="users-you">{t("users.you")}</span>}</td>
                        <td>{u.email}</td>
                        <td>{u.role}</td>
                        <td><Badge status={u.status} /></td>
                        <td>
                          {isLocked ? (
                            <span className="users-locked">{t("users.locked_until", { time: formatDate(u.lockoutuntil, DATETIME_OPTIONS) })}</span>
                          ) : (
                            <span className="users-not-locked">—</span>
                          )}
                        </td>
                        <td className="users-actions">
                          <button type="button" className="users-action-link" onClick={() => setDialog({ type: "password", user: u })}>
                            {t("users.send_pw")}
                          </button>
                          {!isSelf && (
                            <button type="button" className="users-action-link" onClick={() => setDialog({ type: "role", user: u })}>
                              {t("users.change_role")}
                            </button>
                          )}
                          {isLocked && (
                            <button type="button" className="users-action-link" onClick={() => handleUnlock(u)}>
                              {t("users.unlock")}
                            </button>
                          )}
                          {!isSelf && u.status === "Active" && (
                            <button type="button" className="users-action-link users-action-danger" onClick={() => setDialog({ type: "deactivate", user: u })}>
                              {t("users.deactivate")}
                            </button>
                          )}
                          {!isSelf && u.status !== "Active" && (
                            <button type="button" className="users-action-link" onClick={() => setDialog({ type: "reactivate", user: u })}>
                              {t("users.reactivate")}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {dialog?.type === "password" && (
        <SendPasswordEmailDialog user={dialog.user} onClose={() => { setDialog(null); reload(); }} />
      )}
      {dialog?.type === "role" && (
        <ChangeRoleDialog user={dialog.user} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />
      )}
      {(dialog?.type === "deactivate" || dialog?.type === "reactivate") && (
        <StatusDialog
          user={dialog.user}
          activate={dialog.type === "reactivate"}
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); reload(); }}
        />
      )}
    </div>
  );
}

function Modal({ title, children, onClose, labelId = "users-modal-title" }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={labelId} onClick={(e) => e.stopPropagation()}>
        <h2 id={labelId} className="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

const GMAIL_RE = /^[a-z0-9.]{6,30}@gmail\.com$/;

function CreateUserForm({ onCreated }) {
  const { t } = useLocale();
  const [form, setForm] = useState({ name: "", email: "", role: VALID_ROLES[0] });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const email = form.email.trim().toLowerCase();
    if (!form.name.trim()) return setError(t("users.err_name"));
    if (!GMAIL_RE.test(email)) return setError(t("errors.invalid_gmail"));

    setSubmitting(true);
    try {
      await createUser({ name: form.name.trim(), email, role: form.role });
      onCreated(email);
    } catch (err) {
      setError(extractErrorMessage(err, t("errors.create_user")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="users-form-card">
      <form onSubmit={handleSubmit} noValidate>
        <div className="users-form-grid">
          <Field label={t("users.full_name")} required placeholder={t("users.full_name_ph")} value={form.name} onChange={(e) => update("name", e.target.value)} />
          <Field label={t("auth.gmail_label")} required type="email" placeholder="name@gmail.com" value={form.email} onChange={(e) => update("email", e.target.value)} />
          <label className="field">
            <span className="field-label">{t("settings.role")}<span className="field-required"> *</span></span>
            <select className="field-control" value={form.role} onChange={(e) => update("role", e.target.value)}>
              {VALID_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
        </div>
        <p className="users-form-hint">
          <strong>{t("users.hint_strong")}</strong> {t("users.hint_rest")}
        </p>
        {error && <Banner tone="error" title={error} />}
        <div className="users-form-actions">
          <Button type="submit" disabled={submitting}>{submitting ? t("users.sending_invite") : t("users.create_send")}</Button>
        </div>
      </form>
    </Card>
  );
}

function SendPasswordEmailDialog({ user, onClose }) {
  const { t } = useLocale();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null); // "invite" | "recovery"

  async function handleSend() {
    setBusy(true);
    setError("");
    try {
      const result = await sendPasswordEmail(user.userid);
      setSent(result.channel);
    } catch (err) {
      setError(extractErrorMessage(err, t("errors.send_password")));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Modal title={t("users.pw_sent_title")} onClose={onClose}>
        <p className="modal-body">
          {sent === "invite"
            ? t("users.pw_sent_invite", { name: user.name, email: user.email })
            : t("users.pw_sent_recovery", { email: user.email })}{" "}
          {t("users.pw_sent_tail")}
        </p>
        <div className="modal-actions">
          <Button onClick={onClose}>{t("common.done")}</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t("users.pw_title", { name: user.name })} onClose={onClose}>
      <p className="modal-body">
        {t("users.pw_body_a")} <strong>{user.email}</strong>. {t("users.pw_body_b", { name: user.name })}
      </p>
      {error && <Banner tone="error" title={error} />}
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
        <Button onClick={handleSend} disabled={busy}>{busy ? t("common.sending") : t("users.send_email")}</Button>
      </div>
    </Modal>
  );
}

function ChangeRoleDialog({ user, onClose, onDone }) {
  const { t } = useLocale();
  const [role, setRole] = useState(user.role);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setBusy(true);
    setError("");
    try {
      await updateUser(user.userid, { role });
      onDone();
    } catch (err) {
      setError(extractErrorMessage(err, t("errors.change_role")));
      setBusy(false);
    }
  }

  return (
    <Modal title={t("users.role_title", { name: user.name })} onClose={onClose}>
      <p className="modal-body">{t("users.role_body")}</p>
      <label className="field">
        <span className="field-label">{t("settings.role")}</span>
        <select className="field-control" value={role} onChange={(e) => setRole(e.target.value)}>
          {VALID_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      {error && <Banner tone="error" title={error} />}
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
        <Button onClick={handleSave} disabled={busy || role === user.role}>{busy ? t("common.saving") : t("users.save_role")}</Button>
      </div>
    </Modal>
  );
}

function StatusDialog({ user, activate, onClose, onDone }) {
  const { t } = useLocale();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    setError("");
    try {
      if (activate) await updateUser(user.userid, { status: "Active" });
      else await deactivateUser(user.userid);
      onDone();
    } catch (err) {
      setError(extractErrorMessage(err, activate ? t("errors.reactivate") : t("errors.deactivate")));
      setBusy(false);
    }
  }

  return (
    <Modal title={activate ? t("users.react_title", { name: user.name }) : t("users.deact_title", { name: user.name })} onClose={onClose}>
      <p className="modal-body">
        {activate ? t("users.react_body") : t("users.deact_body")}
      </p>
      {error && <Banner tone="error" title={error} />}
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
        <Button variant={activate ? "primary" : "danger"} onClick={handleConfirm} disabled={busy}>
          {busy ? t("common.saving") : activate ? t("users.reactivate") : t("users.deactivate")}
        </Button>
      </div>
    </Modal>
  );
}
