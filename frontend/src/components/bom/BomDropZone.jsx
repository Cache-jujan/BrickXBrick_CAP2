import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../i18n/LocaleProvider";
import "./BomDropZone.css";

// Same limit as the server (backend/src/routes/bom.js, multer fileSize).
const MAX_BYTES = 5 * 1024 * 1024;

const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");

/**
 * A drag-and-drop target for the BOM Excel file, like adding a file in Google
 * Classroom or Teams: drop it on the box, or click the box to browse.
 * It only checks the obvious (one .xlsx, not too big); the server still checks
 * the real contents.
 *
 * onFile(file)     a file that passed the checks
 * onBrowse()       the box was clicked or Enter / Space was pressed
 * onReject(text)   the dropped file was refused, with the reason
 * compact          a slim strip for when a draft is already on the page
 */
export function BomDropZone({ onFile, onBrowse, onReject, busy = false, compact = false }) {
  const { t } = useLocale();
  const [over, setOver] = useState(false);
  const depth = useRef(0); // dragenter/dragleave also fire for child elements

  // A file dropped just outside the box would make the browser open it and leave
  // the page (and any unsaved edits). Stop that while this box is on screen.
  useEffect(() => {
    const guard = (event) => {
      if (hasFiles(event)) event.preventDefault();
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);

  function handleDrop(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth.current = 0;
    setOver(false);
    if (busy) return;
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length !== 1) return onReject(t("bom.drop_one_file"));
    const [file] = files;
    if (!/\.xlsx$/i.test(file.name)) return onReject(t("bom.drop_only_xlsx"));
    if (file.size > MAX_BYTES) return onReject(t("bom.drop_too_big"));
    onFile(file);
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!busy) onBrowse();
    }
  }

  return (
    <div
      className={`bom-drop ${compact ? "bom-drop-compact" : ""} ${over ? "bom-drop-over" : ""} ${busy ? "bom-drop-busy" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={t("bom.drop_aria")}
      aria-disabled={busy}
      onClick={() => { if (!busy) onBrowse(); }}
      onKeyDown={handleKeyDown}
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={handleDrop}
    >
      <span className="bom-drop-icon" aria-hidden="true">⇪</span>
      <span className="bom-drop-text">
        <strong>
          {busy ? t("bom.importing") : over ? t("bom.drop_release") : compact ? t("bom.drop_replace_title") : t("bom.drop_title")}
        </strong>
        {!compact && !busy && <span>{t("bom.drop_or_browse")}</span>}
      </span>
    </div>
  );
}
