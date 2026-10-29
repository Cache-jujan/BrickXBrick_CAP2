import { useEffect, useRef, useState } from "react";
import { acceptTerms, getLegalDocuments } from "../../api/legalApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { LegalHighlights, LegalSkeleton, formatEffectiveDate } from "../../components/legal/LegalReader";
import { ArrowRightIcon, CheckIcon } from "../../components/legal/LegalIcons";
import { LegalBrand, ReadingProgress, readingMinutes } from "./LegalChrome";
import { useLocale } from "../../i18n/LocaleProvider";
import "./LegalPages.css";
import "./TermsConsent.css";

// Shown instead of the app (see ProtectedRoute) until the signed-in user has
// accepted the CURRENT Terms of Use and Privacy Notice. Required by the
// Data Privacy Act (RA 10173): people must be told how their data is used.
// The acceptance (who, version, time, IP, device) is saved by the backend,
// so this page only comes back when TERMS_VERSION is raised.
//
// How agreeing works (one straight scroll, nothing to figure out):
//   - Both documents are shown one after the other.
//   - Right under each document is its own checkbox, so the user ticks it
//     as they reach it.
//   - "Agree and continue" works once every box is ticked. Pressing it early
//     scrolls to the first box still unticked and makes it pulse.

// "3. Your account" -> { num: "3", label: "Your account" }
function splitHeading(heading) {
  const m = /^(\d+)\.\s*(.*)$/.exec(heading);
  return m ? { num: m[1], label: m[2] } : { num: "", label: heading };
}

// What each checkbox says. You agree to the terms; you acknowledge the notice.
function confirmText(doc) {
  return doc.id === "privacy" ? (
    <>
      I have read and acknowledge the <strong>{doc.title}</strong>.
    </>
  ) : (
    <>
      I have read and agree to the <strong>{doc.title}</strong>.
    </>
  );
}

export function TermsAcceptPage() {
  const { user, logout, markTermsAccepted } = useAuth();
  const { t, formatDate } = useLocale();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  // { terms: true } once that document's box is ticked
  const [agreed, setAgreed] = useState({});
  // The id of the box to pulse after pressing "Agree" too early
  const [pulse, setPulse] = useState("");
  const pulseTimer = useRef(null);
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

  useEffect(() => () => clearTimeout(pulseTimer.current), []);

  const docs = data?.documents || [];
  const doneCount = docs.filter((d) => agreed[d.id]).length;
  const allAgreed = docs.length > 0 && doneCount === docs.length;

  // "Agree and continue": if a box is still unticked, take the user to it.
  function handleAcceptClick() {
    if (busy || !data) return;
    const missing = docs.find((d) => !agreed[d.id]);
    if (missing) {
      const box = document.getElementById(`legal-confirm-${missing.id}`);
      box?.scrollIntoView({ behavior: "smooth", block: "center" });
      box?.querySelector("input")?.focus({ preventScroll: true });
      setPulse(missing.id);
      clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setPulse(""), 1600);
      return;
    }
    handleAccept();
  }

  async function handleAccept() {
    setBusy(true);
    setError("");
    try {
      await acceptTerms(data.version);
      markTermsAccepted(data.version);
    } catch (err) {
      if (err?.response?.status === 409) {
        // The terms changed while this page was open: show the new version.
        setAgreed({});
        load();
      }
      setError(extractErrorMessage(err, t("legal.accept_error")));
    } finally {
      setBusy(false);
    }
  }

  const firstName = user?.name ? user.name.split(" ")[0] : "";

  let status;
  if (allAgreed) status = "All set. You can continue.";
  else status = `${doneCount} of ${docs.length} accepted. Tick the box under each document.`;

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
            Brick x Brick holds company records and your personal data, so we need your agreement first. Scroll down
            and tick the box under each document. You&apos;ll only be asked again if they change.
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

            {/* Both documents, one after the other, each ending with its own box. */}
            <div className="legal-stack">
              {docs.map((doc) => {
                const checked = Boolean(agreed[doc.id]);
                return (
                  <article key={doc.id} className="legal-article">
                    <h2 className="legal-article-title">{doc.title}</h2>

                    {doc.sections.map((s) => {
                      const { num, label } = splitHeading(s.heading);
                      return (
                        <section key={s.heading} className="legal-section">
                          <h3 className="legal-section-heading">
                            {num && <span className="legal-section-num">{num}</span>}
                            {label}
                          </h3>
                          {(s.paragraphs || []).map((p, j) => (
                            <p key={j}>{p}</p>
                          ))}
                          {s.bullets?.length > 0 && (
                            <ul>
                              {s.bullets.map((b, j) => (
                                <li key={j}>{b}</li>
                              ))}
                            </ul>
                          )}
                        </section>
                      );
                    })}

                    <label
                      id={`legal-confirm-${doc.id}`}
                      className={
                        "legal-check legal-confirm" +
                        (checked ? " is-checked" : "") +
                        (pulse === doc.id ? " is-pulsing" : "")
                      }
                    >
                      <input
                        type="checkbox"
                        className="legal-check-input"
                        checked={checked}
                        onChange={(e) => setAgreed((current) => ({ ...current, [doc.id]: e.target.checked }))}
                      />
                      <span className="legal-check-box" aria-hidden="true">
                        <CheckIcon />
                      </span>
                      <span className="legal-check-text">{confirmText(doc)}</span>
                    </label>
                  </article>
                );
              })}
            </div>
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
            <p className={"legal-consent-status" + (allAgreed ? " is-done" : "")} aria-live="polite">
              {allAgreed && <CheckIcon />}
              {status}
            </p>
            <Button
              className={"legal-consent-btn" + (allAgreed ? "" : " is-incomplete")}
              onClick={handleAcceptClick}
              disabled={busy}
              aria-disabled={!allAgreed || undefined}
            >
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