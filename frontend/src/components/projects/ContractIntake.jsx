import { useEffect, useRef, useState } from "react";
import { readContractForNewProject } from "../../api/contractApi";
import { extractErrorMessage } from "../../api/client";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { CheckCircleIcon } from "../ui/icons";
import { BomDropZone } from "../bom/BomDropZone";
import { useLocale } from "../../i18n/LocaleProvider";

const DOCX = /\.docx$/i;
const MAX_BYTES = 5 * 1024 * 1024; // same limit as the server

const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");

// Optional first step of "New project": read the signed contract (.docx) and fill the
// form from it. Nothing is saved here; the GM edits every value, and the contract is
// saved on the project once it is created. No contract yet? Skip it and fill the form by hand.
//
// One card, two states: the same drag-and-drop box as the BOM and Contract pages while no
// contract is read; then a single row with the file name and Replace / Remove.
export function ContractIntake({ reading, onRead, onClear }) {
  const { t } = useLocale();
  const fileInput = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);

  // A file dropped just outside a box would make the browser open it and leave the page,
  // losing what was typed. The empty-state box guards this itself; this covers the filled state.
  useEffect(() => {
    if (!reading) return undefined;
    const guard = (event) => {
      if (hasFiles(event)) event.preventDefault();
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, [reading]);

  async function handleFile(file) {
    if (!file || busy) return;
    setError("");
    if (!DOCX.test(file.name)) {
      setError(t("contract.drop_only_docx"));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t("bom.drop_too_big"));
      return;
    }
    setBusy(true);
    try {
      onRead(await readContractForNewProject(file));
    } catch (err) {
      setError(extractErrorMessage(err, t("cp.contract_err_read")));
    } finally {
      setBusy(false);
    }
  }

  function handleCardDrop(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setOver(false);
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length !== 1) {
      setError(t("bom.drop_one_file"));
      return;
    }
    handleFile(files[0]);
  }

  const dropText = {
    title: t("contract.drop_title"),
    orBrowse: t("contract.drop_or_browse"),
    release: t("contract.drop_release"),
    busy: t("cp.contract_reading"),
    onlyType: t("contract.drop_only_docx"),
    aria: t("contract.drop_aria"),
  };

  const warnings = (reading?.flags || []).filter((f) => f.level === "warning");
  const nothingRead = reading && reading.found === 0;

  return (
    <section className="cp-contract" aria-labelledby="cp-contract-title">
      <input
        ref={fileInput}
        type="file"
        className="visually-hidden"
        tabIndex={-1}
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <h2 id="cp-contract-title" className="cp-contract-title">{t("cp.contract_title")}</h2>

      {error && <Banner tone="error" title={error} />}

      {!reading ? (
        <>
          <p className="cp-contract-help">{t("cp.contract_help")}</p>
          <BomDropZone
            allowed={DOCX}
            text={dropText}
            busy={busy}
            onFile={handleFile}
            onBrowse={() => fileInput.current?.click()}
            onReject={setError}
          />
        </>
      ) : (
        <div
          className={`cp-contract-done ${over ? "cp-contract-done-over" : ""}`}
          onDragEnter={(event) => { if (hasFiles(event)) setOver(true); }}
          onDragOver={(event) => { if (hasFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOver(false); }}
          onDrop={handleCardDrop}
        >
          <span className={nothingRead ? "cp-contract-mark cp-contract-mark-warn" : "cp-contract-mark"} aria-hidden="true">
            <CheckCircleIcon size={20} />
          </span>
          <div className="cp-contract-text">
            <p className="cp-contract-file">
              {nothingRead ? t("cp.contract_nothing", { file: reading.fileName }) : t("cp.contract_filled", { file: reading.fileName })}
            </p>
            {!nothingRead && <p className="cp-contract-note">{t("cp.contract_review_note")}</p>}
          </div>
          <div className="cp-contract-actions">
            <Button type="button" variant="secondary" className="btn-sm" onClick={() => fileInput.current?.click()} disabled={busy}>
              {busy ? t("cp.contract_reading") : t("cp.contract_replace")}
            </Button>
            <Button type="button" variant="secondary" className="btn-sm" onClick={onClear} disabled={busy}>
              {t("cp.contract_remove")}
            </Button>
          </div>
        </div>
      )}

      {warnings.map((f) => (
        <Banner key={f.message} tone="warning" title={f.message} />
      ))}
    </section>
  );
}
