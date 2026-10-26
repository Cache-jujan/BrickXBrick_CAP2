import { useEffect, useState } from "react";
import { acceptTerms, getLegalDocuments } from "../../api/legalApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import {
  LegalHighlights,
  LegalReader,
  LegalSkeleton,
  formatEffectiveDate,
} from "../../components/legal/LegalReader";
import { ArrowRightIcon, CheckIcon } from "../../components/legal/LegalIcons";
import { LegalBrand, ReadingProgress, readingMinutes } from "./LegalChrome";
import { useLocale } from "../../i18n/LocaleProvider";
import "./LegalPages.css";

// Shown instead of the app (see ProtectedRoute) until the signed-in user has
// accepted the CURRENT Terms of Use and Privacy Notice. Required by the
// Data Privacy Act (RA 10173): people must be told how their data is used.
// The acceptance (who, version, time, IP, device) is saved by the backend.
export function TermsAcceptPage() {
  const { user, logout, markTermsAccepted } = useAuth();
  const { t, formatDate } = useLocale();
  const [data, setData] = useState(null);
  const [docId, setDocId] = useState("terms");
  const [loadError, setLoadError] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function load() {
    setLoadError("");
    getLegalDocuments()
      .then(setData)
      .catch((err) => setLoadError(extractErrorMessage(err, t("legal.load_error"))));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once; a language change must not refetch
  useEffect(load, []);

  async function handleAccept() {
    if (!checked || !data) return;
    setBusy(true);
    setError("");
    try {
      await acceptTerms(data.version);
      markTermsAccepted(data.version);
    } catch (err) {
      if (err?.response?.status === 409) {
        // The terms changed while this page was open: show the new version.
        setChecked(false);
        load();
      }
      setError(extractErrorMessage(err, t("legal.accept_error")));
    } finally {
      setBusy(false);
    }
  }

  const firstName = user?.name ? user.name.split(" ")[0] : "";

  return (
    <div className="legal-page has-consent">
      <header className="legal-header">
        <div className="legal-header-inner">
          <LegalBrand />
          <div className="legal-header-actions">
            {user?.name && (
              <span className="legal-header-user">
                {t("nav.signed_in_as")} <strong>{user.name}</strong>
              </span>
            )}
            <button type="button" className="legal-text-btn" onClick={logout} disabled={busy}>
              {t("account.logout")}
            </button>
          </div>
        </div>
        <ReadingProgress />
      </header>

      <main className="legal-main">
        <div className="legal-hero">
          <p className="legal-eyebrow">{firstName ? t("legal.eyebrow_named", { name: firstName }) : t("legal.eyebrow")}</p>
          <h1>{t("legal.title")}</h1>
          <p className="legal-lede">
            Brick x Brick holds company records and your personal data, so we need your agreement to the Terms of
            Use and Privacy Notice first. You&apos;ll only be asked again if they change.
          </p>
          {data && (
            <p className="legal-meta">
              <span className="legal-chip">{t("legal.version", { version: data.version })}</span>
              <span>{t("legal.effective", { date: formatEffectiveDate(data.effectiveDate, formatDate) })}</span>
              <span className="legal-meta-dot" aria-hidden="true">·</span>
              <span>{t("legal.read_minutes", { minutes: readingMinutes(data) })}</span>
            </p>
          )}
        </div>

        {loadError && (
          <Banner
            tone="error"
            title={loadError}
            action={
              <Button variant="secondary" onClick={load}>
                {t("common.try_again")}
              </Button>
            }
          />
        )}
        {!loadError && !data && <LegalSkeleton />}

        {data && (
          <>
            <LegalHighlights items={data.highlights} />
            <LegalReader data={data} docId={docId} onDocChange={setDocId} />
          </>
        )}
      </main>

      {data && (
        <div className="legal-consent" role="region" aria-label={t("legal.your_agreement")}>
          <div className="legal-consent-inner">
            {error && (
              <div className="legal-consent-error">
                <Banner tone="error" title={error} />
              </div>
            )}
            <label className={"legal-check" + (checked ? " is-checked" : "")}>
              <input
                type="checkbox"
                className="legal-check-input"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              <span className="legal-check-box" aria-hidden="true">
                <CheckIcon />
              </span>
              <span className="legal-check-text">
                I have read and agree to the <strong>Terms of Use</strong>, and I acknowledge the{" "}
                <strong>Privacy Notice</strong>.
              </span>
            </label>
            <Button className="legal-consent-btn" onClick={handleAccept} disabled={!checked || busy}>
              {busy ? (
                t("common.saving")
              ) : (
                <>
                  {t("legal.agree_continue")} <ArrowRightIcon />
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
