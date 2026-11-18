import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocale } from "../../i18n/LocaleProvider";
import { Banner } from "../ui/Banner";
import { extractErrorMessage } from "../../api/client";
import { uploadTaskDocument } from "../../api/taskDocumentsApi";
import { MilestoneBoard } from "./MilestoneBoard";
import { checkDroppedFile } from "./useTaskFileDrop";
import { MilestoneGroup, PhaseRow } from "./TimelineRows";
import { DATE_OPTIONS, FloatingCard, MilestonePopover, TaskTooltip } from "./TimelineOverlays";
import { buildSchedule, clamp, getMonthCells, getMonthRange, getRange, getWeekCells } from "./timelineSchedule";
import "./ProjectTimeline.css";

const VIEW_STORAGE_KEY = "brickxbrick.timeline-view.v1";
const VIEWS = ["timeline", "board"];
const ZOOMS = ["weeks", "months"];
const HEADER_DATE_OPTIONS = { month: "short", day: "numeric" };
const MONTH_OPTIONS = { month: "short" };
const LABEL_WIDTH = 320; // keep in step with --label-w in ProjectTimeline.css
const NARROW_PADDING = 16; // keep in step with --pad in ProjectTimeline.css
const MIN_MONTH_LABEL_PX = 30;
const WEEK_PX = 78; // keep in step with the week width in ProjectTimeline.css
const CHIP_CLEARANCE_PX = 50; // room the TODAY chip takes up to the right of the today line

function readSavedView() {
  try {
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return VIEWS.includes(saved) ? saved : "timeline";
  } catch {
    return "timeline";
  }
}

function useMedia(query) {
  const read = () => typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

// Milestones are keyed by id (name if an id is missing) so a refreshed project
// keeps its open milestones open.
const keyOf = (milestone) => String(milestone.milestoneid ?? milestone.name);

function toggleIn(set, key) {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export const ProjectTimeline = memo(function ProjectTimeline({ project, canManage = false, onAddMilestone, onEditTimeline, onAddTask, onCompleteTask, onOpenDocuments }) {
  const { t, tv, formatDate } = useLocale();
  const uid = useId();
  const milestones = useMemo(() => (Array.isArray(project?.milestones) ? project.milestones : []), [project]);
  const hasSiteManager = Boolean(project?.sitemanagerid);
  const [view, setView] = useState(readSavedView);
  const [zoom, setZoom] = useState("months");
  const [expanded, setExpanded] = useState(() => new Set());
  const [closedPhases, setClosedPhases] = useState(() => new Set());
  const [openTaskKey, setOpenTaskKey] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [chartWidth, setChartWidth] = useState(0);
  // Result of dropping files onto a task: { tone: "info" | "success" | "error", text }.
  const [dropStatus, setDropStatus] = useState(null);
  const uploadingRef = useRef(false);
  const leaveTimer = useRef(null);
  const scrollRef = useRef(null);
  const canHover = useMedia("(hover: hover)");
  const narrow = useMedia("(max-width: 899px)");

  const weekRange = useMemo(() => getRange(project, milestones), [project, milestones]);
  const monthRange = useMemo(() => getMonthRange(project, milestones), [project, milestones]);
  const range = zoom === "months" ? monthRange : weekRange;
  const schedule = useMemo(() => buildSchedule(project, milestones), [project, milestones]);
  const cells = useMemo(() => (zoom === "months" ? getMonthCells(monthRange) : getWeekCells(weekRange)), [zoom, monthRange, weekRange]);
  const phases = [
    { id: "Planning", label: t("tl.pre_construction"), items: milestones.filter((m) => m.phase === "Planning") },
    { id: "Construction", label: t("projects.construction"), items: milestones.filter((m) => m.phase !== "Planning") },
  ].filter((phase) => phase.items.length > 0);
  const now = new Date();
  const todayInRange = now >= range.start && now <= range.end;
  const todayPosition = clamp(((now - range.start) / range.total) * 100, 0, 100);
  const chipFlipped = todayPosition > 88;
  const trackPx = chartWidth - (narrow ? 0 : LABEL_WIDTH) - (narrow ? NARROW_PADDING * 2 : 0);
  const fullTrackPx = zoom === "weeks" ? cells.length * WEEK_PX : trackPx;

  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  // The "attached" notice clears itself; an error stays until the next drop.
  useEffect(() => {
    if (dropStatus?.tone !== "success") return undefined;
    const timer = window.setTimeout(() => setDropStatus(null), 6000);
    return () => window.clearTimeout(timer);
  }, [dropStatus]);

  // Files dropped on a Planning task are attached right away (the same upload as the Documents dialog).
  // Every file is checked before the first one is sent, so a bad file in a batch uploads nothing.
  const handleDropFiles = useCallback(async (task, files) => {
    if (uploadingRef.current) return; // one drop at a time
    for (const file of files) {
      const problem = checkDroppedFile(file);
      if (problem) {
        setDropStatus({ tone: "error", text: `${file.name}: ${t(problem)}` });
        return;
      }
    }
    uploadingRef.current = true;
    let attached = 0;
    try {
      for (const file of files) {
        setDropStatus({ tone: "info", text: t("docs.drop_uploading", { name: file.name, task: task.taskname }) });
        await uploadTaskDocument(task.taskid, file);
        attached += 1;
      }
      setDropStatus({ tone: "success", text: t(attached === 1 ? "docs.drop_done_one" : "docs.drop_done_other", { count: attached, task: task.taskname }) });
    } catch (err) {
      const base = extractErrorMessage(err, t("docs.err_attach"));
      // Earlier files in the same drop may already be attached; say so rather than imply nothing happened.
      setDropStatus({ tone: "error", text: attached > 0 ? `${t("docs.drop_partial", { count: attached, task: task.taskname })} ${base}` : base });
    } finally {
      uploadingRef.current = false;
    }
  }, [t]);

  // A popover opened on old data (or a bar that no longer exists) must not linger after a refresh.
  useEffect(() => {
    setHovered(null);
  }, [project, canHover]);

  // The chart's own width decides which month labels fit, and how wide the
  // pinned label column is when the chart scrolls sideways on a phone.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    setChartWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => setChartWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [view]);

  function chooseView(next) {
    setView(next);
    setHovered(null);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // The choice still applies for this visit if browser storage is blocked.
    }
  }

  const leaveBar = useCallback(() => {
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setHovered(null), 160);
  }, []);

  function enterPopover() {
    window.clearTimeout(leaveTimer.current);
  }

  function toggleMilestone(key) {
    setHovered(null);
    setOpenTaskKey(null);
    setExpanded((current) => toggleIn(current, key));
  }

  function togglePhase(id) {
    setHovered(null);
    setClosedPhases((current) => toggleIn(current, id));
  }

  function jumpToToday() {
    const element = scrollRef.current;
    if (!element) return;
    const labelWidth = narrow ? 0 : LABEL_WIDTH;
    const padding = narrow ? NARROW_PADDING : 0;
    const track = element.scrollWidth - labelWidth - padding * 2;
    const x = labelWidth + padding + (track * todayPosition) / 100;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    element.scrollTo({ left: Math.max(0, x - labelWidth - (element.clientWidth - labelWidth) / 2), behavior: reduced ? "auto" : "smooth" });
  }

  const hoveredMilestone = hovered?.type === "milestone" ? hovered.item : null;
  const hoveredTask = hovered?.type === "task" ? hovered.item : null;
  const subtitle = view === "board" ? t("tl.subtitle.board") : t(canHover ? "tl.subtitle" : "tl.subtitle.tap");
  // Only people who can open a task's documents can drop files on it (the backend enforces the same).
  const onDropFiles = onOpenDocuments ? handleDropFiles : undefined;

  return (
    <section className="project-timeline" aria-labelledby="project-timeline-title">
      <header className="project-timeline-header">
        <div>
          <h2 id="project-timeline-title">{t("tl.title")}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="project-timeline-actions">
          <div className="project-timeline-views" role="group" aria-label={t("tl.view.label")}>
            {VIEWS.map((option) => (
              <button
                type="button"
                key={option}
                className="project-timeline-view"
                aria-pressed={view === option}
                onClick={() => chooseView(option)}
              >
                {t(`tl.view.${option}`)}
              </button>
            ))}
          </div>
          {canManage && onEditTimeline && milestones.length > 0 && (
            <button type="button" className="project-timeline-add" onClick={onEditTimeline}>{t("tl.edit_timeline")}</button>
          )}
          {canManage && <button type="button" className="project-timeline-add" onClick={onAddMilestone}>+ {t("pd.add_milestone")}</button>}
        </div>
      </header>

      {dropStatus && (
        <div className="file-drop-status" role={dropStatus.tone === "error" ? undefined : "status"}>
          <Banner tone={dropStatus.tone} title={dropStatus.text} />
        </div>
      )}

      {view === "board" ? (
        <MilestoneBoard milestones={milestones} canManage={canManage} hasSiteManager={hasSiteManager} onAddTask={onAddTask} onCompleteTask={onCompleteTask} onOpenDocuments={onOpenDocuments} onDropFiles={onDropFiles} />
      ) : (
        <>
          <div className="tl-toolbar">
            <div className="tl-bulk">
              <button type="button" className="tl-text-btn" onClick={() => setExpanded(new Set(milestones.map(keyOf)))}>{t("tl.expand_all")}</button>
              <button type="button" className="tl-text-btn" onClick={() => setExpanded(new Set())}>{t("tl.collapse_all")}</button>
            </div>
            <div className="tl-zoom">
              <span className="tl-zoom-label">{t("tl.zoom")}</span>
              <div className="tl-zoom-group" role="group" aria-label={t("tl.zoom")}>
                {ZOOMS.map((option) => (
                  <button type="button" key={option} className="tl-zoom-btn" aria-pressed={zoom === option} onClick={() => setZoom(option)}>
                    {t(`tl.zoom.${option}`)}
                  </button>
                ))}
              </div>
              <button type="button" className="tl-jump" disabled={zoom === "months"} onClick={jumpToToday}>{t("tl.jump_today")}</button>
            </div>
          </div>

          <div
            className={`tl-scroll tl-scroll-${zoom}`}
            ref={scrollRef}
            role="region"
            aria-label={t("tl.view.timeline")}
            tabIndex={zoom === "weeks" ? 0 : undefined}
          >
            <div className="tl-canvas" data-zoom={zoom} style={{ "--week-count": cells.length, "--tl-w": chartWidth ? `${chartWidth}px` : "100%" }}>
              <div className="tl-axis">
                <div className="tl-label tl-axis-label">{t("tl.phase_milestone")}</div>
                <div className="tl-axis-track">
                  {cells.map((cell, index) => {
                    const fits = zoom === "weeks" || (trackPx * cell.width) / 100 >= MIN_MONTH_LABEL_PX;
                    // On desktop the TODAY chip shares the axis row, so a label that would sit under it is left out.
                    const gapPx = ((cell.left - todayPosition) * fullTrackPx) / 100;
                    const clash = !narrow && todayInRange && (chipFlipped ? gapPx < 10 && gapPx > -CHIP_CLEARANCE_PX : gapPx > -10 && gapPx < CHIP_CLEARANCE_PX);
                    return (
                      <span className={`tl-axis-cell${index === 0 ? " is-first" : ""}`} key={cell.key} style={{ left: `${cell.left}%`, width: `${cell.width}%` }}>
                        {fits && !clash && formatDate(cell.date, zoom === "months" ? MONTH_OPTIONS : HEADER_DATE_OPTIONS)}
                      </span>
                    );
                  })}
                  {todayInRange && <i className="tl-today-axis" style={{ left: `${todayPosition}%` }} aria-hidden="true" />}
                  {todayInRange && <span className={`tl-today-chip${chipFlipped ? " is-end" : ""}`} style={{ left: `${todayPosition}%` }}>{t("tl.today")}</span>}
                </div>
              </div>

              <div className="tl-body">
                <div className="tl-layer" aria-hidden="true">
                  {cells.slice(1).map((cell) => <i className="tl-gridline" key={cell.key} style={{ left: `${cell.left}%` }} />)}
                  {todayInRange && <i className="tl-today-line" style={{ left: `${todayPosition}%` }} />}
                </div>
                {phases.length === 0 && (
                  <div className="timeline-empty-timeline">{t("tl.empty_before")} <strong>+ {t("pd.add_milestone")}</strong> {t("tl.empty_after")}</div>
                )}
                {phases.map((phase) => {
                  const open = !closedPhases.has(phase.id);
                  const bodyId = `${uid}-${phase.id}`;
                  return (
                    <div className="tl-phase" key={phase.id}>
                      <PhaseRow label={phase.label} count={phase.items.length} open={open} bodyId={bodyId} onToggle={() => togglePhase(phase.id)} />
                      {open && (
                        <div id={bodyId}>
                          {phase.items.map((milestone) => {
                            const key = keyOf(milestone);
                            return (
                              <MilestoneGroup
                                key={key}
                                milestone={milestone}
                                expanded={expanded.has(key)}
                                onToggle={() => toggleMilestone(key)}
                                openTaskKey={openTaskKey}
                                onToggleTask={(taskKey) => setOpenTaskKey((current) => (current === taskKey ? null : taskKey))}
                                schedule={schedule}
                                range={range}
                                canHover={canHover}
                                canManage={canManage}
                                hasSiteManager={hasSiteManager}
                                onHover={setHovered}
                                onLeave={leaveBar}
                                onAddTask={onAddTask}
                                onCompleteTask={onCompleteTask}
                                onOpenDocuments={onOpenDocuments}
                                onDropFiles={onDropFiles}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <footer className="project-timeline-footer">
            <div className="timeline-legend">
              <strong>{t("tl.status")}</strong>
              <span><i className="legend-swatch on-track" />{tv("status", "On Track")}</span>
              <span><i className="legend-swatch at-risk" />{tv("status", "At Risk")}</span>
              <span><i className="legend-swatch overdue" />{tv("status", "Overdue")}</span>
              <span><i className="legend-swatch pending" />{tv("status", "Pending")}</span>
              <span><i className="legend-swatch task" />{t("tl.legend_task")}</span>
              <span className="legend-filled"><i className="legend-swatch on-track" />{t("tl.legend_filled")}</span>
            </div>
            <span className="timeline-footer-range">{formatDate(monthRange.start, DATE_OPTIONS)} → {formatDate(monthRange.lastDay, DATE_OPTIONS)}</span>
          </footer>
        </>
      )}

      {view === "timeline" && hoveredMilestone && (
        <FloatingCard
          anchor={hovered.anchor}
          width={286}
          contentKey={(hoveredMilestone.tasks || []).length}
          className="timeline-overlay-popover"
          onEnter={enterPopover}
          onLeave={leaveBar}
        >
          <MilestonePopover milestone={hoveredMilestone} canManage={canManage} onAddTask={onAddTask} onCompleteTask={onCompleteTask} onOpenDocuments={onOpenDocuments} />
        </FloatingCard>
      )}
      {view === "timeline" && hoveredTask && (
        <FloatingCard anchor={hovered.anchor} width={238} contentKey={hoveredTask.status} className="timeline-overlay-tooltip" onEnter={enterPopover} onLeave={leaveBar}>
          <TaskTooltip task={hoveredTask} />
        </FloatingCard>
      )}
    </section>
  );
});