import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { listProgressSubmissions, reviewProgressSubmission } from "../../api/taskProgressApi";
import { extractErrorMessage } from "../../api/client";
import { Badge } from "../../components/ui/Badge";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { useLocale } from "../../i18n/LocaleProvider";
import "./ProgressReviewPage.css";

const DATETIME_OPTIONS = { dateStyle: "medium", timeStyle: "short" };

// Common reasons a PM sends a photo back. "Other" opens a text box. The chosen
// text is what the Site Manager sees on their phone.
const FLAG_REASONS = [
  "review.reason_blurry",
  "review.reason_unfinished",
  "review.reason_incomplete",
  "review.reason_wrong",
  "review.reason_quality",
];
const OTHER = "__other__";

export function ProgressReviewPage() {
  const { t, formatDate } = useLocale();
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Per submission: { choice, other } from the reason dropdown.
  const [reasonById, setReasonById] = useState({});
  // Submissions where Flag was pressed without a reason: outlined in red.
  const [missingReasonId, setMissingReasonId] = useState(null);
  const [submittingId, setSubmittingId] = useState(null);
  // Deep-link from the dashboard "Needs your attention" panel: ?focus=<logId>
  // scrolls to that submission's card and highlights it briefly.
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("focus");
  const [highlightId, setHighlightId] = useState(null);

  async function loadQueue() {
    setLoading(true);
    setError("");
    try {
      setSubmissions(await listProgressSubmissions());
    } catch (err) {
      setError(extractErrorMessage(err, t("errors.load_review_queue")));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once; a language change must not refetch
  }, []);

  useEffect(() => {
    if (!focusId || loading) return undefined;
    if (!submissions.some((s) => String(s.logid) === String(focusId))) return undefined;
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`submission-${focusId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    setHighlightId(focusId);
    const timer = setTimeout(() => setHighlightId(null), 2500);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, [focusId, loading, submissions]);

  async function handleReview(submission, decision) {
    const picked = reasonById[submission.logid] || {};
    const reason = picked.choice === OTHER ? (picked.other || "").trim() : picked.choice || "";
    if (decision === "Flag" && !reason) {
      setMissingReasonId(submission.logid);
      setError(
        picked.choice === OTHER ? t("review.err_other") : t("review.err_choose")
      );
      return;
    }
    setMissingReasonId(null);

    setSubmittingId(submission.logid);
    setError("");
    try {
      await reviewProgressSubmission(submission.logid, decision, reason);
      setSubmissions((current) => current.filter((item) => item.logid !== submission.logid));
    } catch (err) {
      setError(extractErrorMessage(err, t("errors.review_failed")));
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <div className="progress-review">
      <div className="progress-review-header">
        <div>
          <h1>{t("review.title")}</h1>
          <p className="progress-review-subtitle">{t("review.subtitle")}</p>
        </div>
        <Button variant="secondary" type="button" onClick={loadQueue} disabled={loading}>
          {t("review.refresh")}
        </Button>
      </div>

      {error && <Banner tone="error" title={error} />}
      {loading && <p className="progress-review-loading">{t("review.loading")}</p>}
      {!loading && submissions.length === 0 && (
        <Card className="progress-review-empty">
          <h2>{t("review.clear_title")}</h2>
          <p>{t("review.clear_body")}</p>
        </Card>
      )}

      {!loading && submissions.length > 0 && (
        <div className="progress-review-list">
          {submissions.map((submission) => {
            const isSubmitting = submittingId === submission.logid;
            const picked = reasonById[submission.logid] || {};
            const setPicked = (patch) =>
              setReasonById((current) => ({ ...current, [submission.logid]: { ...picked, ...patch } }));
            return (
              <Card
                key={submission.logid}
                id={`submission-${submission.logid}`}
                className={"progress-review-card" + (String(submission.logid) === String(highlightId) ? " progress-review-card-focus" : "")}
              >
                <div className="progress-review-card-top">
                  <div>
                    <div className="progress-review-meta">
                      <Badge status={submission.reviewstatus} />
                      <span>{t("review.submitted", { date: formatDate(submission.createdat, DATETIME_OPTIONS) })}</span>
                    </div>
                    <h2>{submission.taskname}</h2>
                    <p className="progress-review-context">
                      {submission.projectname} &middot; {submission.milestonename}
                    </p>
                  </div>
                </div>

                {submission.photoevidenceurl ? (
                  <a href={submission.photoevidenceurl} target="_blank" rel="noreferrer" className="progress-review-photo-link">
                    <img src={submission.photoevidenceurl} alt={t("review.evidence_alt", { name: submission.taskname })} className="progress-review-photo" />
                    <span>{t("review.open_photo")}</span>
                  </a>
                ) : (
                  <p className="progress-review-no-photo">{t("review.no_photo")}</p>
                )}

                {submission.note && (
                  <div className="progress-review-note">
                    <strong>{t("review.sm_note")}</strong>
                    <p>{submission.note}</p>
                  </div>
                )}

                <div className="progress-review-actions">
                  <Button type="button" onClick={() => handleReview(submission, "Acknowledge")} disabled={isSubmitting}>
                    {isSubmitting ? t("common.saving") : t("review.acknowledge")}
                  </Button>
                  <div className="progress-review-flag">
                    <select
                      aria-label={t("review.flag_aria")}
                      className={missingReasonId === submission.logid && !picked.choice ? "progress-review-invalid" : undefined}
                      value={picked.choice || ""}
                      onChange={(event) => setPicked({ choice: event.target.value })}
                      disabled={isSubmitting}
                    >
                      <option value="">{t("review.flag_placeholder")}</option>
                      {FLAG_REASONS.map((key) => (
                        <option key={key} value={t(key)}>{t(key)}</option>
                      ))}
                      <option value={OTHER}>{t("review.other")}</option>
                    </select>
                    {picked.choice === OTHER && (
                      <input
                        type="text"
                        placeholder={t("review.type_reason")}
                        aria-label={t("review.other_aria")}
                        className={missingReasonId === submission.logid && !(picked.other || "").trim() ? "progress-review-invalid" : undefined}
                        value={picked.other || ""}
                        onChange={(event) => setPicked({ other: event.target.value })}
                        disabled={isSubmitting}
                        autoFocus
                      />
                    )}
                    <Button variant="danger" type="button" onClick={() => handleReview(submission, "Flag")} disabled={isSubmitting}>
                      {t("review.flag")}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}