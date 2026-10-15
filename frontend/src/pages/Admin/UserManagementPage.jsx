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
import "./UserManagementPage.css";

export function UserManagementPage() {
  const { user: me } = useAuth();
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
      setListError(extractErrorMessage(err, "Couldn't load user accounts."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
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
      setRowError(extractErrorMessage(err, "Couldn't unlock this account."));
    }
  }

  return (
    <div className="users-page">
      <div className="spread users-header">
        <div>
          <h1>User Accounts</h1>
          <p className="users-subtitle">
            Create accounts, change roles, and send password emails. Users always set their own
            password from the email link.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "Add User"}
        </Button>
      </div>

      {showForm && (
        <CreateUserForm
          onCreated={(email) => {
            setShowForm(false);
            setNotice(`Invitation sent to ${email}.`);
            reload();
          }}
        />
      )}
      {notice && <Banner tone="info" title={notice} />}

      <div className="users-toolbar">
        <input
          type="search"
          className="users-search"
          placeholder="Search by name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search users"
        />
        <select className="users-filter" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role">
          <option value="All">All roles</option>
          {VALID_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="users-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option value="All">All statuses</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
      </div>

      {listError && <Banner tone="error" title={listError} />}
      {rowError && <Banner tone="error" title={rowError} />}
      {!listError && loading && <p className="dashboard-loading">Loading accounts…</p>}

      {!listError && !loading && (
        <Card className="users-table-card">
          {visible.length === 0 ? (
            <div className="users-empty">
              <Banner tone="empty" title={users.length === 0 ? "No user accounts yet" : "No accounts match your filters"}>
                {users.length === 0 ? "Add the first account to get started." : "Try a different search or filter."}
              </Banner>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="users-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Lockout</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((u) => {
                    const isSelf = u.userid === me.id;
                    const isLocked = u.lockoutuntil && new Date(u.lockoutuntil) > new Date();
                    return (
                      <tr key={u.userid}>
                        <td>{u.name}{isSelf && <span className="users-you"> (you)</span>}</td>
                        <td>{u.email}</td>
                        <td>{u.role}</td>
                        <td><Badge status={u.status} /></td>
                        <td>
                          {isLocked ? (
                            <span className="users-locked">Until {new Date(u.lockoutuntil).toLocaleString()}</span>
                          ) : (
                            <span className="users-not-locked">—</span>
                          )}
                        </td>
                        <td className="users-actions">
                          <button type="button" className="users-action-link" onClick={() => setDialog({ type: "password", user: u })}>
                            Send password email
                          </button>
                          {!isSelf && (
                            <button type="button" className="users-action-link" onClick={() => setDialog({ type: "role", user: u })}>
                              Change role
                            </button>
                          )}
                          {isLocked && (
                            <button type="button" className="users-action-link" onClick={() => handleUnlock(u)}>
                              Unlock
                            </button>
                          )}
                          {!isSelf && u.status === "Active" && (
                            <button type="button" className="users-action-link users-action-danger" onClick={() => setDialog({ type: "deactivate", user: u })}>
                              Deactivate
                            </button>
                          )}
                          {!isSelf && u.status !== "Active" && (
                            <button type="button" className="users-action-link" onClick={() => setDialog({ type: "reactivate", user: u })}>
                              Reactivate
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
    if (!form.name.trim()) return setError("Full name is required.");
    if (!GMAIL_RE.test(email)) return setError("Enter a valid Gmail address (name@gmail.com).");

    setSubmitting(true);
    try {
      await createUser({ name: form.name.trim(), email, role: form.role });
      onCreated(email);
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't create the account."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="users-form-card">
      <form onSubmit={handleSubmit} noValidate>
        <div className="users-form-grid">
          <Field label="Full Name" required placeholder="e.g. Juan Dela Cruz" value={form.name} onChange={(e) => update("name", e.target.value)} />
          <Field label="Gmail Address" required type="email" placeholder="name@gmail.com" value={form.email} onChange={(e) => update("email", e.target.value)} />
          <label className="field">
            <span className="field-label">Role<span className="field-required"> *</span></span>
            <select className="field-control" value={form.role} onChange={(e) => update("role", e.target.value)}>
              {VALID_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
        </div>
        <p className="users-form-hint">
          <strong>Enforce change password upon login:</strong> an invitation email is sent to this Gmail and the
          user sets their own password from the link before their first sign-in. You never see or type it.
        </p>
        {error && <Banner tone="error" title={error} />}
        <div className="users-form-actions">
          <Button type="submit" disabled={submitting}>{submitting ? "Sending invite…" : "Create & Send Invite"}</Button>
        </div>
      </form>
    </Card>
  );
}

function SendPasswordEmailDialog({ user, onClose }) {
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
      setError(extractErrorMessage(err, "Couldn't send the password email."));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Modal title="Password email sent" onClose={onClose}>
        <p className="modal-body">
          {sent === "invite"
            ? `${user.name} hasn't set a password yet, so their invitation was sent again to ${user.email}.`
            : `A link to set a new password was sent to ${user.email}. Their old password no longer works.`}{" "}
          They choose the new password themselves from that link.
        </p>
        <div className="modal-actions">
          <Button onClick={onClose}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Send a password email to ${user.name}?`} onClose={onClose}>
      <p className="modal-body">
        A link goes to <strong>{user.email}</strong>. {user.name} sets a new password from it; you never
        see or type it. Their current password stops working right away, and any login lockout is cleared.
      </p>
      {error && <Banner tone="error" title={error} />}
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={handleSend} disabled={busy}>{busy ? "Sending…" : "Send email"}</Button>
      </div>
    </Modal>
  );
}

function ChangeRoleDialog({ user, onClose, onDone }) {
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
      setError(extractErrorMessage(err, "Couldn't change the role."));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Change role for ${user.name}`} onClose={onClose}>
      <p className="modal-body">
        Their past records keep their name. If they still manage an open project, have unfinished
        tasks or have material requests waiting on them, reassign those first.
      </p>
      <label className="field">
        <span className="field-label">Role</span>
        <select className="field-control" value={role} onChange={(e) => setRole(e.target.value)}>
          {VALID_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      {error && <Banner tone="error" title={error} />}
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={handleSave} disabled={busy || role === user.role}>{busy ? "Saving…" : "Save role"}</Button>
      </div>
    </Modal>
  );
}

function StatusDialog({ user, activate, onClose, onDone }) {
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
      setError(extractErrorMessage(err, activate ? "Couldn't reactivate this account." : "Couldn't deactivate this account."));
      setBusy(false);
    }
  }

  return (
    <Modal title={activate ? `Reactivate ${user.name}?` : `Deactivate ${user.name}?`} onClose={onClose}>
      <p className="modal-body">
        {activate
          ? "They will be able to sign in again with their current password."
          : "They will no longer be able to sign in. Their records stay in the system. Open projects, tasks and requests must be reassigned first."}
      </p>
      {error && <Banner tone="error" title={error} />}
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={activate ? "primary" : "danger"} onClick={handleConfirm} disabled={busy}>
          {busy ? "Saving…" : activate ? "Reactivate" : "Deactivate"}
        </Button>
      </div>
    </Modal>
  );
}
