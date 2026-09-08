import { useEffect, useState } from "react";
import {
  listUsers,
  createUser,
  deactivateUser,
  unlockUser,
  VALID_ROLES,
} from "../../api/adminApi";
import { extractErrorMessage } from "../../api/client";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Banner } from "../../components/ui/Banner";
import "./UserManagementPage.css";

const EMPTY_FORM = { name: "", email: "", role: VALID_ROLES[0], tempPassword: "" };

export function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [showForm, setShowForm] = useState(false);

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

  return (
    <div>
      <div className="spread users-header">
        <h1>User Accounts</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Add User"}
        </Button>
      </div>

      {showForm && (
        <CreateUserForm
          onCreated={() => {
            setShowForm(false);
            reload();
          }}
        />
      )}

      {listError && <Banner tone="error" title={listError} />}

      {!listError && loading && <p className="dashboard-loading">Loading accounts…</p>}

      {!listError && !loading && (
        <Card className="users-table-card">
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
              {users.map((u) => (
                <UserRow key={u.userid} user={u} onChanged={reload} />
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <div className="users-empty">
              <Banner tone="empty" title="No user accounts yet">
                Add the first account to get started.
              </Banner>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function CreateUserForm({ onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await createUser({
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        tempPassword: form.tempPassword.trim() || undefined,
      });
      onCreated();
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
          <Field
            label="Full Name"
            required
            placeholder="e.g. Juan Dela Cruz"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
          />
          <Field
            label="Email Address"
            required
            type="email"
            placeholder="name@company.com"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
          />
          <label className="field">
            <span className="field-label">
              Role<span className="field-required"> *</span>
            </span>
            <select
              className="field-control"
              value={form.role}
              onChange={(e) => update("role", e.target.value)}
            >
              {VALID_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Temporary Password"
            placeholder="Leave blank to auto-generate"
            value={form.tempPassword}
            onChange={(e) => update("tempPassword", e.target.value)}
          />
        </div>

        {error && <Banner tone="error" title={error} />}

        <div className="users-form-actions">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create Account"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function UserRow({ user, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState("");

  async function handleDeactivate() {
    setBusy(true);
    setRowError("");
    try {
      await deactivateUser(user.userid);
      onChanged();
    } catch (err) {
      setRowError(extractErrorMessage(err, "Couldn't deactivate this account."));
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlock() {
    setBusy(true);
    setRowError("");
    try {
      await unlockUser(user.userid);
      onChanged();
    } catch (err) {
      setRowError(extractErrorMessage(err, "Couldn't unlock this account."));
    } finally {
      setBusy(false);
    }
  }

  const isLocked = user.lockoutuntil && new Date(user.lockoutuntil) > new Date();

  return (
    <tr>
      <td>{user.name}</td>
      <td>{user.email}</td>
      <td>{user.role}</td>
      <td>
        <Badge status={user.status} />
      </td>
      <td>
        {isLocked ? (
          <span className="users-locked">
            Until {new Date(user.lockoutuntil).toLocaleString()}
          </span>
        ) : (
          <span className="users-not-locked">—</span>
        )}
      </td>
      <td className="users-actions">
        {isLocked && (
          <button type="button" className="users-action-link" disabled={busy} onClick={handleUnlock}>
            Unlock
          </button>
        )}
        {user.status === "Active" && (
          <button
            type="button"
            className="users-action-link users-action-danger"
            disabled={busy}
            onClick={handleDeactivate}
          >
            Deactivate
          </button>
        )}
        {!isLocked && user.status !== "Active" && (
          <span className="users-not-locked">—</span>
        )}
        {rowError && <span className="users-row-error">{rowError}</span>}
      </td>
    </tr>
  );
}
