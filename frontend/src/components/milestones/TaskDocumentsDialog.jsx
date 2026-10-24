import { useEffect, useRef, useState } from "react";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { extractErrorMessage } from "../../api/client";
import {
  deleteTaskDocument,
  getTaskDocumentUrl,
  listTaskDocuments,
  uploadTaskDocument,
} from "../../api/taskDocumentsApi";
import { useLocale } from "../../i18n/LocaleProvider";
import "./TaskDocumentsDialog.css";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const DATETIME_OPTIONS = { dateStyle: "medium", timeStyle: "short" };

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Documents for one Planning task. canEdit is false when the task is already
// completed or the project is closed: the list is then read-only.
export function TaskDocumentsDialog({ task, canEdit, onClose }) {
  const { t, formatDate } = useLocale();
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  async function load() {
    try {
      setDocuments(await listTaskDocuments(task.taskid));
    } catch (err) {
      setError(extractErrorMessage(err, t("docs.err_load")));
      setDocuments((current) => current || []);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.taskid]);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow picking the same file again
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError(t("docs.err_type"));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t("docs.err_size"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await uploadTaskDocument(task.taskid, file);
      await load();
    } catch (err) {
      setError(extractErrorMessage(err, t("docs.err_attach")));
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen(doc) {
    // Open the tab now, from the click, so popup blockers allow it; point it
    // at the file once the server has given us the link.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    setError("");
    try {
      const { url } = await getTaskDocumentUrl(task.taskid, doc.documentID);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (err) {
      if (tab) tab.close();
      setError(extractErrorMessage(err, t("docs.err_open")));
    }
  }

  async function handleRemove(doc) {
    if (!window.confirm(t("docs.confirm_remove", { name: doc.fileName }))) return;
    setBusy(true);
    setError("");
    try {
      await deleteTaskDocument(task.taskid, doc.documentID);
      await load();
    } catch (err) {
      setError(extractErrorMessage(err, t("docs.err_remove")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" role="presentation" onClick={() => { if (!busy) onClose(); }}>
      <div className="modal task-docs" role="dialog" aria-modal="true" aria-labelledby="task-docs-title" onClick={(ev) => ev.stopPropagation()}>
        <h2 id="task-docs-title" className="modal-title">{t("docs.title", { name: task.taskname })}</h2>

        {error && <Banner tone="error" title={error} />}

        {documents === null ? (
          <p className="modal-body">{t("common.loading")}</p>
        ) : documents.length === 0 ? (
          <p className="modal-body">{t("docs.none")}</p>
        ) : (
          <ul className="task-docs-list">
            {documents.map((doc) => (
              <li key={doc.documentID} className="task-docs-item">
                <div className="task-docs-info">
                  <button type="button" className="task-docs-name" onClick={() => handleOpen(doc)}>
                    {doc.fileName}
                  </button>
                  <span className="task-docs-meta">
                    {formatSize(doc.sizeBytes)} · {doc.uploadedByName || t("tamper.unknown_user")} · {formatDate(doc.uploadedAt, DATETIME_OPTIONS)}
                  </span>
                </div>
                {canEdit && (
                  <button type="button" className="task-docs-remove" onClick={() => handleRemove(doc)} disabled={busy}>
                    {t("common.remove")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {!canEdit && documents !== null && (
          <p className="task-docs-locked">{t("docs.locked")}</p>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
          onChange={handleFile}
          hidden
        />
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t("pd.close")}</Button>
          {canEdit && (
            <Button onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? t("common.working") : t("docs.attach")}
            </Button>
          )}
        </div>
        {canEdit && <p className="task-docs-hint">{t("docs.hint")}</p>}
      </div>
    </div>
  );
}
