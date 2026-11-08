import { useEffect, useRef, useState } from "react";
import { acceptTerms, getLegalDocuments } from "../../api/legalApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { LegalDraftNotice, LegalHighlights, LegalSkeleton, formatEffectiveDate } from "../../components/legal/LegalReader";
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
//   - Both documents are shown one after the other, with jump links at the top.
//   - One checkbox sits in the bar at the bottom of the screen, always in
//     view, and covers both documents.
//   - "Agree and continue" works once it is ticked. Pressing it early makes
//     the box pulse.

// "3. Your account" -> { num: "3", label: "Your account" }
function splitHeading(heading) {
  const m = /^(\d+)\.\s*(.*)$/.exec(heading);
  return m ? { num: m[1], label: m[2] } : { num: "", label: heading };
}

export function TermsAcceptPage() {
  const { user, logout, markTermsAccepted } = useAuth();
  const { t, formatDate } = useLocale();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  // The one box in the bottom bar covers both documents.
  const [agreed, setAgreed] = useState(false);
  // Pulses the box after pressing "Agree" before ticking it
  const [pulse, setPulse] = useState(false);
  const pulseTimer = useRef(null);
  const checkRef = useRef(null);
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
  const allAgreed = docs.length > 0 && agreed;

  // "Agree and continue" before the box is ticked: it is right beside the
  // button, so just draw the eye to it.
  function handleAcceptClick() {
    if (busy || !data) return;
    if (!agreed) {
      checkRef.current?.querySelector("input")?.focus({ preventScroll: true });
      setPulse(true);
      clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setPulse(false), 1600);
      return;
    }
    handleAccept();
  }

  function jumpTo(id) {
    document.getElementById(`legal-doc-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
        setAgreed(false);
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
            Brick x Brick holds company records and your personal data, so we need your agreement first. Read the
            documents below, then agree at the bottom of the screen. You&apos;ll only be asked again if they change.
          </p>
          {data && (
            <p className="legal-meta">
              <span className="legal-chip">{t("legal.version", { version: data.version })}</span>
              <span>{t("legal.effective", { date: formatEffectiveDate(data.effectiveDate, formatDate) })}</span>
              <span className="legal-meta-dot" aria-hidden="true">·</span>
              <span>{t("legal.read_minutes", { minutes: readingMinutes(data) })}</span>
            </p>
          )}
          {docs.length > 1 && (
            <div className="legal-jump" aria-label="Jump to a document">
              {docs.map((d) => (
                <button key={d.id} type="button" className="legal-jump-btn" onClick={() => jumpTo(d.id)}>
                  {d.title}
                </button>
              ))}
            </div>
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
            <LegalDraftNotice review={data.review} />
            <LegalHighlights items={data.highlights} />

            {/* Both documents, one after the other, each ending with its own box. */}
            <div className="legal-stack">
              {docs.map((doc) => {
                return (
                  <article key={doc.id} id={`legal-doc-${doc.id}`} className="legal-article">
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
            <label
              ref={checkRef}
              className={"legal-check" + (agreed ? " is-checked" : "") + (pulse ? " is-pulsing" : "")}
            >
              <input
                type="checkbox"
                className="legal-check-input"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span className="legal-check-box" aria-hidden="true">
                <CheckIcon />
              </span>
              <span className="legal-check-text">
                I have read and agree to the{" "}
                {docs.map((d, i) => (
                  <span key={d.id}>
                    <strong>{d.title}</strong>
                    {i < docs.length - 2 ? ", " : i === docs.length - 2 ? " and " : "."}
                  </span>
                ))}
              </span>
            </label>
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