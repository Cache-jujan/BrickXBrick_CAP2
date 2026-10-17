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
import "./TaskDocumentsDialog.css";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const DATE = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Documents for one Planning task. canEdit is false when the task is already
// completed or the project is closed: the list is then read-only.
export function TaskDocumentsDialog({ task, canEdit, onClose }) {
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  async function load() {
    try {
      setDocuments(await listTaskDocuments(task.taskid));
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't load the documents."));
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
      setError("Attach a PDF, JPEG or PNG file. Export Word or Excel files to PDF first.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("That file is larger than 10 MB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await uploadTaskDocument(task.taskid, file);
      await load();
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't attach the file. Please try again."));
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
      setError(extractErrorMessage(err, "Couldn't open that document."));
    }
  }

  async function handleRemove(doc) {
    if (!window.confirm(`Remove "${doc.fileName}"?`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteTaskDocument(task.taskid, doc.documentID);
      await load();
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't remove the document."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" role="presentation" onClick={() => { if (!busy) onClose(); }}>
      <div className="modal task-docs" role="dialog" aria-modal="true" aria-labelledby="task-docs-title" onClick={(ev) => ev.stopPropagation()}>
        <h2 id="task-docs-title" className="modal-title">Documents: {task.taskname}</h2>

        {error && <Banner tone="error" title={error} />}

        {documents === null ? (
          <p className="modal-body">Loading…</p>
        ) : documents.length === 0 ? (
          <p className="modal-body">No documents attached yet.</p>
        ) : (
          <ul className="task-docs-list">
            {documents.map((doc) => (
              <li key={doc.documentID} className="task-docs-item">
                <div className="task-docs-info">
                  <button type="button" className="task-docs-name" onClick={() => handleOpen(doc)}>
                    {doc.fileName}
                  </button>
                  <span className="task-docs-meta">
                    {formatSize(doc.sizeBytes)} · {doc.uploadedByName || "Unknown"} · {DATE.format(new Date(doc.uploadedAt))}
                  </span>
                </div>
                {canEdit && (
                  <button type="button" className="task-docs-remove" onClick={() => handleRemove(doc)} disabled={busy}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {!canEdit && documents !== null && (
          <p className="task-docs-locked">Documents can't be changed because this task is completed or the project is closed.</p>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
          onChange={handleFile}
          hidden
        />
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
          {canEdit && (
            <Button onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? "Working…" : "Attach file"}
            </Button>
          )}
        </div>
        {canEdit && <p className="task-docs-hint">PDF, JPEG or PNG, up to 10 MB.</p>}
      </div>
    </div>
  );
}
