import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { listProgressSubmissions, reviewProgressSubmission } from "../../api/taskProgressApi";
import { extractErrorMessage } from "../../api/client";
import { Badge } from "../../components/ui/Badge";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import "./ProgressReviewPage.css";

const DATE = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

export function ProgressReviewPage() {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reasonById, setReasonById] = useState({});
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
      setError(extractErrorMessage(err, "Couldn't load the progress-review queue."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQueue();
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
    const reason = reasonById[submission.logid] || "";
    if (decision === "Flag" && !reason.trim()) {
      setError("Enter a reason before flagging a submission.");
      return;
    }

    setSubmittingId(submission.logid);
    setError("");
    try {
      await reviewProgressSubmission(submission.logid, decision, reason);
      setSubmissions((current) => current.filter((item) => item.logid !== submission.logid));
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't review this progress submission."));
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <div className="progress-review">
      <div className="progress-review-header">
        <div>
          <h1>Task Progress Review</h1>
          <p className="progress-review-subtitle">
            Review Site Manager photo updates before marking tasks complete.
          </p>
        </div>
        <Button variant="secondary" type="button" onClick={loadQueue} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error && <Banner tone="error" title={error} />}
      {loading && <p className="progress-review-loading">Loading progress submissions…</p>}
      {!loading && submissions.length === 0 && (
        <Card className="progress-review-empty">
          <h2>Review queue is clear</h2>
          <p>New Site Manager progress submissions will appear here.</p>
        </Card>
      )}

      {!loading && submissions.length > 0 && (
        <div className="progress-review-list">
          {submissions.map((submission) => {
            const isSubmitting = submittingId === submission.logid;
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
                      <span>Submitted {DATE.format(new Date(submission.createdat))}</span>
                    </div>
                    <h2>{submission.taskname}</h2>
                    <p className="progress-review-context">
                      {submission.projectname} &middot; {submission.milestonename}
                    </p>
                  </div>
                </div>

                {submission.photoevidenceurl ? (
                  <a href={submission.photoevidenceurl} target="_blank" rel="noreferrer" className="progress-review-photo-link">
                    <img src={submission.photoevidenceurl} alt={`Evidence for ${submission.taskname}`} className="progress-review-photo" />
                    <span>Open full-size evidence photo</span>
                  </a>
                ) : (
                  <p className="progress-review-no-photo">No evidence photo was returned.</p>
                )}

                {submission.note && (
                  <div className="progress-review-note">
                    <strong>Site Manager note</strong>
                    <p>{submission.note}</p>
                  </div>
                )}

                <div className="progress-review-actions">
                  <Button type="button" onClick={() => handleReview(submission, "Acknowledge")} disabled={isSubmitting}>
                    {isSubmitting ? "Saving…" : "Acknowledge & Complete"}
                  </Button>
                  <div className="progress-review-flag">
                    <input
                      type="text"
                      placeholder="Reason for flagging"
                      value={reasonById[submission.logid] || ""}
                      onChange={(event) => setReasonById((current) => ({ ...current, [submission.logid]: event.target.value }))}
                      disabled={isSubmitting}
                    />
                    <Button variant="danger" type="button" onClick={() => handleReview(submission, "Flag")} disabled={isSubmitting}>
                      Flag
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