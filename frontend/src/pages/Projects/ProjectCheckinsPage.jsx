import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { getProjectCheckins, reviewCheckin } from "../../api/checkinsApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Badge } from "../../components/ui/Badge";
import { Banner } from "../../components/ui/Banner";
import { BackLink } from "../../components/ui/BackLink";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import "./ProjectCheckinsPage.css";

const SLOT_ORDER = ["Morning", "Midday", "EndOfDay"];
const SLOT_LABEL = { Morning: "Morning", Midday: "Midday", EndOfDay: "End of day" };
const STATE_TEXT = { Submitted: "Sent", Missed: "Missed", Open: "Open", Upcoming: "Not yet", NotRequired: "—" };
const RANGES = [
  { days: 7, label: "Last 7 days" },
  { days: 14, label: "Last 14 days" },
  { days: 30, label: "Last 30 days" },
];

// One photo thumbnail. If the image cannot load (offline, expired or blocked
// link), show a labelled placeholder instead of a broken-image icon.
function CheckinPhoto({ url, index }) {
  const [failed, setFailed] = useState(false);
  const label = `Check-in photo ${index + 1}`;
  return (
    <a href={url} target="_blank" rel="noreferrer" title={failed ? "Photo could not be loaded. Click to try opening it." : label}>
      {failed ? (
        <span className="checkin-photo-missing" role="img" aria-label={`${label} could not be loaded`}>
          <strong>Photo {index + 1}</strong>
          <span>Could not be loaded</span>
        </span>
      ) : (
        <img src={url} alt={label} loading="lazy" onError={() => setFailed(true)} />
      )}
    </a>
  );
}

// "2026-10-23" -> "Fri, Oct 23". Parsed as a plain calendar day, so the
// viewer's time zone can never shift it.
function dayLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
function addDays(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}
const TIME = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
const timeLabel = (value) => (value ? TIME.format(new Date(value)) : "");

export function ProjectCheckinsPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [search] = useSearchParams();
  const focusId = search.get("focus");

  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // "todo" = waiting for the PM (not reviewed, or flagged and waiting on the Site Manager).
  // "history" = acknowledged, kept out of the way so the list does not pile up.
  const [view, setView] = useState("todo");
  // Which check-in has its review form open, with its draft.
  const [flagging, setFlagging] = useState(null);
  const [flagComment, setFlagComment] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState("");
  const focusedRef = useRef(false);
  const isDone = (c) => c.review?.decision === "Acknowledged";

  // Only the Project Manager of the project may review; the backend enforces it too.
  const canReview = user.role === "Project Manager";

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError("");
      try {
        // The server decides what "today" is (Philippine time). Its default is the
        // last 7 days; for a longer range, ask again with dates ending on its "to".
        const result = await getProjectCheckins(id);
        setData(days === 7 ? result : await getProjectCheckins(id, { from: addDays(result.to, -(days - 1)), to: result.to }));
      } catch (err) {
        setError(extractErrorMessage(err, "Unable to load check-ins."));
      } finally {
        setLoading(false);
      }
    },
    [id, days]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Coming from a notification: scroll to that check-in once, and show it.
  useEffect(() => {
    if (!focusId || focusedRef.current || !data) return;
    const target = data.checkins.find((c) => c.checkinId === focusId);
    if (target && isDone(target) && view !== "history") {
      setView("history");
      return;
    }
    const el = document.getElementById(`checkin-${focusId}`);
    if (el) {
      focusedRef.current = true;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, data, view]);

  const historyCount = useMemo(() => (data?.checkins || []).filter(isDone).length, [data]);
  const todoCount = (data?.checkins.length || 0) - historyCount;
  const visible = useMemo(
    () => (data?.checkins || []).filter((c) => (view === "history" ? isDone(c) : !isDone(c))),
    [data, view]
  );

  async function submitReview(checkin, decision, comment) {
    setBusyId(checkin.checkinId);
    setActionError("");
    try {
      await reviewCheckin(checkin.checkinId, { decision, comment });
      setFlagging(null);
      setFlagComment("");
      await load(true);
    } catch (err) {
      setActionError(extractErrorMessage(err, "Unable to save your review."));
    } finally {
      setBusyId(null);
    }
  }

  if (loading && !data) return <p className="dashboard-loading">Loading check-ins…</p>;
  if (error && !data) {
    return (
      <div className="checkins-page">
        <BackLink to={`/projects/${id}`}>Back to project</BackLink>
        <Banner tone="error" title={error} />
      </div>
    );
  }

  const { project, grid, counts, windows } = data;

  return (
    <div className="checkins-page">
      <BackLink to={`/projects/${id}`}>Back to project</BackLink>

      <header className="page-header">
        <div className="page-header-text">
          <h1>Daily check-ins</h1>
          <p className="page-header-sub">
            <Link to={`/projects/${id}`}>{project.name}</Link> · The Site Manager reports three times a day. A check-in
            is a report only: it does not change tasks, milestones or progress.
          </p>
        </div>
        <div className="page-header-actions">
          {RANGES.map((range) => (
            <Button
              key={range.days}
              variant={days === range.days ? "primary" : "secondary"}
              onClick={() => setDays(range.days)}
              aria-pressed={days === range.days}
            >
              {range.label}
            </Button>
          ))}
        </div>
      </header>

      {error && <Banner tone="error" title={error} />}
      {actionError && <Banner tone="error" title={actionError} />}

      <section className="checkins-counts" aria-label="Summary">
        <Card className="checkins-count">
          <span className={`checkins-count-num ${counts.needsAction > 0 ? "is-alert" : ""}`}>{counts.needsAction}</span>
          <span className="checkins-count-label">Need your action</span>
        </Card>
        <Card className="checkins-count">
          <span className="checkins-count-num">{counts.unreviewed}</span>
          <span className="checkins-count-label">Not yet reviewed</span>
        </Card>
        <Card className="checkins-count">
          <span className={`checkins-count-num ${counts.missed > 0 ? "is-warn" : ""}`}>{counts.missed}</span>
          <span className="checkins-count-label">Missed slots</span>
        </Card>
        <Card className="checkins-count">
          <span className="checkins-count-num">{counts.total}</span>
          <span className="checkins-count-label">Check-ins in range</span>
        </Card>
      </section>

      <div className="section-head">
        <h2>Who checked in when</h2>
        <span className="section-head-note">
          Morning {windows.Morning} · Midday {windows.Midday} · End of day {windows.EndOfDay} (Philippine time)
        </span>
      </div>
      <Card className="checkins-grid-card">
        <div className="table-scroll">
          <table className="users-table checkins-grid">
            <thead>
              <tr>
                <th>Day</th>
                {SLOT_ORDER.map((s) => (
                  <th key={s}>{SLOT_LABEL[s]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row) => (
                <tr key={row.day}>
                  <td className="checkins-grid-day">{dayLabel(row.day)}</td>
                  {row.slots.map((cell) => {
                    const mine = data.checkins.find((c) => c.day === row.day && c.slot === cell.slot);
                    return (
                      <td key={cell.slot}>
                        {mine ? (
                          <a href={`#checkin-${mine.checkinId}`} className={`checkins-cell is-sent site-${mine.siteStatus.replace(/\s/g, "").toLowerCase()}`}>
                            {mine.siteStatus}
                            {mine.needsPmAction && !mine.review ? " ⚑" : ""}
                          </a>
                        ) : (
                          <span className={`checkins-cell is-${cell.state.toLowerCase()}`}>{STATE_TEXT[cell.state]}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="section-head">
        <h2>Check-ins</h2>
        <div className="checkins-tabs" role="tablist" aria-label="Check-ins">
          <button type="button" role="tab" aria-selected={view === "todo"} className={view === "todo" ? "is-on" : ""} onClick={() => setView("todo")}>
            To review ({todoCount})
          </button>
          <button type="button" role="tab" aria-selected={view === "history"} className={view === "history" ? "is-on" : ""} onClick={() => setView("history")}>
            History ({historyCount})
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <Banner tone="empty" title={view === "history" ? "No acknowledged check-ins yet" : data.checkins.length ? "Nothing waiting for review" : "No check-ins in this range"}>
          {view === "history"
            ? "Check-ins you acknowledge are moved here."
            : data.checkins.length
              ? "Every check-in in this range has been acknowledged. Find them under History."
              : "Check-ins sent by the Site Manager will appear here."}
        </Banner>
      ) : (
        <div className="checkins-list">
          {visible.map((c) => {
            const open = flagging === c.checkinId;
            return (
              <Card key={c.checkinId} id={`checkin-${c.checkinId}`} className={`checkin-card ${focusId === c.checkinId ? "is-focus" : ""}`}>
                <div className="checkin-head">
                  <div>
                    <h3>
                      {dayLabel(c.day)} · {c.slotLabel}
                    </h3>
                    <p className="checkin-meta">
                      {c.submittedByName} · sent {timeLabel(c.submittedAt)}
                      {!c.onTime && <span className="checkin-late"> · outside its time window</span>}
                    </p>
                  </div>
                  <div className="checkin-badges">
                    <Badge status={c.siteStatus === "On Track" ? "On Track" : c.siteStatus === "Delayed" ? "At Risk" : "Overdue"}>{c.siteStatus}</Badge>
                    {c.needsPmAction && <span className="checkin-flag">Needs your action</span>}
                  </div>
                </div>

                <p className="checkin-summary">{c.summary}</p>
                {c.issues && (
                  <div className={`checkin-issues ${c.needsPmAction ? "is-action" : ""}`}>
                    <strong>Issues:</strong> {c.issues}
                  </div>
                )}
                {c.tasks.length > 0 && (
                  <p className="checkin-tasks">
                    <strong>About:</strong> {c.tasks.map((t) => t.taskName).join(", ")}
                  </p>
                )}
                {c.photos.length > 0 && (
                  <div className="checkin-photos">
                    {c.photos.map((url, i) => (
                      <CheckinPhoto key={url} url={url} index={i} />
                    ))}
                  </div>
                )}

                <div className="checkin-review">
                  {c.review && !open && (
                    <p className={`checkin-review-note is-${c.review.decision.toLowerCase()}`}>
                      <strong>{c.review.decision === "Flagged" ? "Flagged" : "Acknowledged"}</strong>
                      {c.review.reviewedByName ? ` by ${c.review.reviewedByName}` : ""}
                      {c.review.comment ? `: ${c.review.comment}` : ""}
                    </p>
                  )}
                  {canReview && !open && (
                    <div className="checkin-actions">
                      {(!c.review || c.review.decision !== "Acknowledged") && (
                        <Button variant="secondary" disabled={busyId === c.checkinId} onClick={() => submitReview(c, "Acknowledged")}>
                          Acknowledge
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        disabled={busyId === c.checkinId}
                        onClick={() => {
                          setFlagging(c.checkinId);
                          setFlagComment(c.review?.comment || "");
                          setActionError("");
                        }}
                      >
                        {c.review?.decision === "Flagged" ? "Edit flag" : "Flag"}
                      </Button>
                    </div>
                  )}
                  {open && (
                    <div className="checkin-flag-form">
                      <label htmlFor={`flag-${c.checkinId}`}>What should the Site Manager do?</label>
                      <textarea
                        id={`flag-${c.checkinId}`}
                        rows={3}
                        maxLength={500}
                        value={flagComment}
                        onChange={(e) => setFlagComment(e.target.value)}
                        placeholder="Required. The Site Manager sees this."
                      />
                      <div className="checkin-actions">
                        <Button
                          variant="danger"
                          disabled={busyId === c.checkinId || !flagComment.trim()}
                          onClick={() => submitReview(c, "Flagged", flagComment.trim())}
                        >
                          Send flag
                        </Button>
                        <Button variant="ghost" onClick={() => setFlagging(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
