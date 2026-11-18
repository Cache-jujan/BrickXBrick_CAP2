import { useRef, useState } from "react";
import { readContractForNewProject } from "../../api/contractApi";
import { extractErrorMessage } from "../../api/client";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { BomDropZone } from "../bom/BomDropZone";
import { useLocale } from "../../i18n/LocaleProvider";

const DOCX = /\.docx$/i;
const MAX_BYTES = 5 * 1024 * 1024; // same limit as the server

// Optional first step of "New project": read the signed contract (.docx) and fill the
// form from it. Nothing is saved here; the GM edits every value, and the contract is
// saved on the project once it is created. No contract yet? Skip it and fill the form by hand.
// The file box is the same drag-and-drop box as the BOM and Contract pages.
export function ContractIntake({ reading, onRead, onClear }) {
  const { t } = useLocale();
  const fileInput = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(file) {
    if (!file || busy) return;
    setError("");
    if (!DOCX.test(file.name)) {
      setError(t("cp.contract_err_docx"));
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

  const dropText = {
    title: t("contract.drop_title"),
    orBrowse: t("contract.drop_or_browse"),
    release: t("contract.drop_release"),
    replaceTitle: t("cp.contract_drop_replace"),
    busy: t("cp.contract_reading"),
    onlyType: t("contract.drop_only_docx"),
    aria: t("contract.drop_aria"),
  };

  const warnings = (reading?.flags || []).filter((f) => f.level === "warning");

  return (
    <section className="cp-contract" aria-labelledby="cp-contract-title">
      <h2 id="cp-contract-title" className="create-project-title">{t("cp.contract_title")}</h2>
      <p className="create-project-hint">{t("cp.contract_help")}</p>

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

      {error && <Banner tone="error" title={error} />}

      {reading && (
        <>
          {reading.found === 0 ? (
            <Banner tone="warning" title={t("cp.contract_nothing", { file: reading.fileName })} />
          ) : (
            <Banner tone="success" title={t("cp.contract_filled", { file: reading.fileName })}>
              {t("cp.contract_review_note")}
            </Banner>
          )}
          {warnings.map((f) => (
            <Banner key={f.message} tone="warning" title={f.message} />
          ))}
        </>
      )}

      <BomDropZone
        compact={Boolean(reading)}
        allowed={DOCX}
        text={dropText}
        busy={busy}
        onFile={handleFile}
        onBrowse={() => fileInput.current?.click()}
        onReject={setError}
      />

      {reading && (
        <div className="cp-contract-actions">
          <Button type="button" variant="secondary" onClick={onClear} disabled={busy}>
            {t("cp.contract_remove")}
          </Button>
        </div>
      )}
    </section>
  );
}
