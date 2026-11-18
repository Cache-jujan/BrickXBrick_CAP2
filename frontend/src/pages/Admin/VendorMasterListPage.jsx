import { useEffect, useMemo, useState } from "react";
import { listVendors, createVendor, updateVendor, deleteVendor, PERMIT_TYPES } from "../../api/adminApi";
import { extractErrorMessage } from "../../api/client";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Banner } from "../../components/ui/Banner";
import { useLocale } from "../../i18n/LocaleProvider";
import "./UserManagementPage.css"; // the table, toolbar and action-link styles are shared with User accounts
import "./VendorMasterListPage.css";

const TIN_RE = /^\d{3}-\d{3}-\d{3}(-\d{3,5})?$/;

const blankForm = () => ({
  vendorName: "", location: "", tin: "", birPermitType: "", birPermitNumber: "",
});

export function VendorMasterListPage() {
  const { t } = useLocale();
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  // { type: "form", vendor?: row } to add or edit, { type: "delete", vendor: row }
  const [dialog, setDialog] = useState(null);

  async function reload() {
    setLoading(true);
    setListError("");
    try {
      setVendors(await listVendors());
    } catch (err) {
      setListError(extractErrorMessage(err, t("errors.load_vendors")));
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
    return vendors.filter((v) => {
      if (!q) return true;
      return [v.vendorName, v.location, v.tin, v.birPermitNumber].some((x) => (x || "").toLowerCase().includes(q));
    });
  }, [vendors, search]);

  function done(message) {
    setDialog(null);
    setNotice(message);
    reload();
  }

  return (
    <div className="users-page vendors-page">
      <div className="spread users-header">
        <div>
          <h1>{t("nav.vendor_list")}</h1>
          <p className="users-subtitle">{t("vm.subtitle")}</p>
        </div>
        <Button onClick={() => { setNotice(""); setDialog({ type: "form" }); }}>{t("vm.add")}</Button>
      </div>

      {notice && <Banner tone="info" title={notice} />}

      <div className="users-toolbar">
        <input
          type="search"
          className="users-search"
          placeholder={t("vm.search_ph")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t("vm.search_label")}
        />
      </div>

      {listError && <Banner tone="error" title={listError} />}
      {!listError && loading && <p className="dashboard-loading">{t("vm.loading")}</p>}

      {!listError && !loading && (
        <Card className="users-table-card">
          {visible.length === 0 ? (
            <div className="users-empty">
              <Banner tone="empty" title={vendors.length === 0 ? t("vm.none") : t("vm.no_match")}>
                {vendors.length === 0 ? t("vm.add_first") : t("vm.try_filter")}
              </Banner>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="users-table vendors-table">
                <thead>
                  <tr>
                    <th>{t("vm.col_vendor")}</th>
                    <th>{t("vm.col_tin")}</th>
                    <th>{t("vm.col_permit")}</th>
                    <th aria-label={t("tamper.actions")} />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((v) => (
                    <tr key={v.vendorID}>
                      <td className="vendors-name-cell">
                        <span className="vendors-name">{v.vendorName}</span>
                        {v.location && <span className="vendors-location">{v.location}</span>}
                      </td>
                      <td data-label={t("vm.col_tin")}>{v.tin ? <span className="vendors-code">{v.tin}</span> : <span className="users-not-locked">—</span>}</td>
                      <td data-label={t("vm.col_permit")}>
                        {v.birPermitNumber ? (
                          <span className="vendors-permit">
                            <span className="vendors-permit-type">{v.birPermitType}</span>
                            <span className="vendors-code">{v.birPermitNumber}</span>
                          </span>
                        ) : <span className="users-not-locked">—</span>}
                      </td>
                      <td className="users-actions vendors-actions">
                        <button type="button" className="users-action-link" onClick={() => { setNotice(""); setDialog({ type: "form", vendor: v }); }}>
                          {t("vm.edit")}
                        </button>
                        <button type="button" className="users-action-link users-action-danger" onClick={() => { setNotice(""); setDialog({ type: "delete", vendor: v }); }}>
                          {t("vm.delete")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {dialog?.type === "form" && (
        <VendorFormDialog
          vendor={dialog.vendor}
          onClose={() => setDialog(null)}
          onDone={(name, wasEdit) => done(t(wasEdit ? "vm.updated" : "vm.added", { name }))}
        />
      )}
      {dialog?.type === "delete" && (
        <DeleteVendorDialog
          vendor={dialog.vendor}
          onClose={() => setDialog(null)}
          onDone={(name) => done(t("vm.deleted", { name }))}
        />
      )}
    </div>
  );
}

function Modal({ title, children, onClose, labelId = "vendors-modal-title" }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="modal vendors-modal" role="dialog" aria-modal="true" aria-labelledby={labelId} onClick={(e) => e.stopPropagation()}>
        <h2 id={labelId} className="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function VendorFormDialog({ vendor, onClose, onDone }) {
  const { t } = useLocale();
  const editing = Boolean(vendor);
  const [form, setForm] = useState(() => (vendor ? {
    vendorName: vendor.vendorName ?? "",
    location: vendor.location ?? "",
    tin: vendor.tin ?? "",
    birPermitType: vendor.birPermitType ?? "",
    birPermitNumber: vendor.birPermitNumber ?? "",
  } : blankForm()));
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const found = {};
    if (!form.vendorName.trim()) found.vendorName = t("vm.err_name");
    if (form.tin.trim() && !TIN_RE.test(form.tin.trim())) found.tin = t("vm.err_tin");
    if (form.birPermitNumber.trim() && !form.birPermitType) found.birPermitType = t("vm.err_permit_type");
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const payload = {
      vendorName: form.vendorName.trim(),
      location: form.location.trim() || null,
      tin: form.tin.trim() || null,
      birPermitType: form.birPermitType || null,
      birPermitNumber: form.birPermitNumber.trim() || null,
    };
    setBusy(true);
    try {
      if (editing) await updateVendor(vendor.vendorID, payload);
      else await createVendor(payload);
      onDone(payload.vendorName, editing);
    } catch (err) {
      const fieldErrors = err?.response?.data?.fieldErrors;
      if (Array.isArray(fieldErrors) && fieldErrors.length > 0) {
        setErrors(Object.fromEntries(fieldErrors.filter((f) => f.field).map((f) => [f.field, f.message])));
      }
      setError(extractErrorMessage(err, t("errors.save_vendor")));
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? t("vm.edit_title", { name: vendor.vendorName }) : t("vm.add_title")} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <div className="vendors-form-grid">
          <Field className="vendors-span-2" label={t("vm.f_name")} required placeholder={t("vm.f_name_ph")} maxLength={200}
            value={form.vendorName} error={errors.vendorName} onChange={(e) => update("vendorName", e.target.value)} autoFocus />
          <Field className="vendors-span-2" label={t("vm.f_location")} maxLength={200}
            value={form.location} error={errors.location} onChange={(e) => update("location", e.target.value)} />
          <Field label={t("vm.f_tin")} placeholder="123-456-789-00000" maxLength={20} inputMode="numeric"
            value={form.tin} error={errors.tin} onChange={(e) => update("tin", e.target.value)} />
          <label className="field">
            <span className="field-label">{t("vm.f_permit_type")}</span>
            <select className={`field-control ${errors.birPermitType ? "field-control-error" : ""}`} value={form.birPermitType} onChange={(e) => update("birPermitType", e.target.value)}>
              <option value="">{t("vm.f_permit_none")}</option>
              {PERMIT_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            {errors.birPermitType && <span className="field-error">{errors.birPermitType}</span>}
          </label>
          <Field className="vendors-span-2" label={t("vm.f_permit_number")} maxLength={50}
            value={form.birPermitNumber} error={errors.birPermitNumber} onChange={(e) => update("birPermitNumber", e.target.value)} />
        </div>
        {error && <Banner tone="error" title={error} />}
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={busy}>{busy ? t("common.saving") : editing ? t("vm.save_edit") : t("vm.save_add")}</Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteVendorDialog({ vendor, onClose, onDone }) {
  const { t } = useLocale();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    setError("");
    try {
      await deleteVendor(vendor.vendorID);
      onDone(vendor.vendorName);
    } catch (err) {
      setError(extractErrorMessage(err, t("errors.delete_vendor")));
      setBusy(false);
    }
  }

  return (
    <Modal title={t("vm.del_title", { name: vendor.vendorName })} onClose={onClose}>
      <p className="modal-body">{t("vm.del_body")}</p>
      {error && <Banner tone="error" title={error} />}
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
        <Button variant="danger" onClick={handleConfirm} disabled={busy}>{busy ? t("common.saving") : t("vm.delete")}</Button>
      </div>
    </Modal>
  );
}
