import { useRef, useState } from "react";
import { readContractForNewProject } from "../../api/contractApi";
import { extractErrorMessage } from "../../api/client";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { useLocale } from "../../i18n/LocaleProvider";

const DOCX = /\.docx$/i;

// Optional first step of "New project": read the signed contract (.docx) and fill the
// form from it. Nothing is saved here; the GM edits every value, and the contract is
// saved on the project once it is created. No contract yet? Skip it and fill the form by hand.
export function ContractIntake({ reading, onRead, onClear }) {
  const { t } = useLocale();
  const fileInput = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(file) {
    if (!file) return;
    setError("");
    if (!DOCX.test(file.name)) {
      setError(t("cp.contract_err_docx"));
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

      {reading ? (
        <>
          <Banner tone="success" title={t("cp.contract_filled", { file: reading.fileName })}>
            {t("cp.contract_review_note")}
          </Banner>
          {warnings.map((f) => (
            <Banner key={f.message} tone="warning" title={f.message} />
          ))}
          <div className="cp-contract-actions">
            <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()} disabled={busy}>
              {busy ? t("cp.contract_reading") : t("cp.contract_replace")}
            </Button>
            <Button type="button" variant="ghost" onClick={onClear} disabled={busy}>
              {t("cp.contract_remove")}
            </Button>
          </div>
        </>
      ) : (
        <div className="cp-contract-actions">
          <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()} disabled={busy}>
            {busy ? t("cp.contract_reading") : t("cp.contract_choose")}
          </Button>
        </div>
      )}
    </section>
  );
}
