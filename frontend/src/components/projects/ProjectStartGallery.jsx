import { useMemo, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { InfoIcon } from "../ui/icons";
import { ChevronRightGlyph, FileGlyph, FilePlusGlyph } from "../ui/glyphs";
import { CategoryIcon, TemplateSummaryDialog } from "./TemplateSummary";
import "./ProjectStartGallery.css";

// First screen of "New project". Left: how to start (blank sheet or copy a past project) and the
// template categories. Right: the templates of the open category, or the past projects to copy.
// A single click chooses; Next (or a double-click / double-tap, or Enter on the chosen row) opens it.
//
// value: null (blank) | { mode: "template", templateId, name, projectType }
//      | { mode: "copy", sourceProjectId, name, projectType }
// One click chooses, two quick clicks or taps open. Browsers do not send a real
// double-click on phones, so the timing is measured here for both.
const DOUBLE_TAP_MS = 400;
function useDoubleTap(onSingle, onDouble) {
  const last = useRef(0);
  return () => {
    const now = Date.now();
    if (onDouble && now - last.current < DOUBLE_TAP_MS) {
      last.current = 0;
      onDouble();
      return;
    }
    last.current = now;
    onSingle();
  };
}

const SIZE_TITLE = { small: "Small", large: "Large", custom: "Custom" };

export function ProjectStartGallery({ templates, sources, value, onChange, onNext, onCancel }) {
  const [search, setSearch] = useState("");
  const [showSummary, setShowSummary] = useState(false);
  const mode = value?.mode || "blank";

  const groups = useMemo(() => {
    const byType = new Map();
    for (const t of templates) {
      if (!byType.has(t.projectType)) byType.set(t.projectType, []);
      byType.get(t.projectType).push(t);
    }
    // "Other" (the custom layout) always comes last, not in the middle.
    return [...byType.entries()].sort(([a], [b]) => (a === "Other") - (b === "Other"));
  }, [templates]);

  // The category whose templates are listed on the right. Follows the chosen template, else the first one.
  const [openType, setOpenType] = useState(value?.mode === "template" ? value.projectType : null);
  const activeType = groups.some(([type]) => type === openType) ? openType : groups[0]?.[0] ?? null;
  const activeList = groups.find(([type]) => type === activeType)?.[1] ?? [];

  const visibleSources = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? sources.filter((s) => `${s.name} ${s.clientName} ${s.projectType}`.toLowerCase().includes(q))
      : sources;
  }, [sources, search]);

  const pickedTemplate = mode === "template" ? templates.find((t) => t.templateId === value.templateId) : null;

  const pickedLabel =
    mode === "template" ? value.name
    : mode === "copy" ? (value?.sourceProjectId ? value.name : "Choose a project to copy")
    : "Blank project";

  // Choose this starting point and go straight to the next step.
  function open(next) {
    onChange(next);
    onNext(next);
  }

  const templateChoice = (t) => ({ mode: "template", templateId: t.templateId, name: t.name, projectType: t.projectType });

  // Details show once a template, or a past project to copy, is chosen.
  const hasDetails = mode === "template" || (mode === "copy" && Boolean(value?.sourceProjectId));

  const canContinue = mode === "blank" || mode === "template" || (mode === "copy" && value?.sourceProjectId);

  return (
    <div className="psg">
      <div className="psg-lead">
        <span className="psg-lead-icon"><InfoIcon size={22} /></span>
        <p>
          Start with an empty project, or begin from a template or a past project. A template only fills in
          milestones and tasks to save typing. Dates are worked out from your project dates, and everything can
          still be edited afterwards.
        </p>
      </div>
      <p className="psg-tip">Tip: double-click (or double-tap) a choice to open it right away.</p>

      <div className="psg-body">
        <div className="psg-left">
          <section aria-labelledby="psg-start">
            <h2 id="psg-start" className="psg-heading">Quick start</h2>
            <div className="psg-quick" role="radiogroup" aria-label="How to start">
              <Choice
                className="psg-card"
                selected={mode === "blank"}
                onSelect={() => onChange(null)}
                onOpen={() => open(null)}
              >
                <span className="psg-icon"><FilePlusGlyph size={26} /></span>
                <span className="psg-card-title">Blank project</span>
                <span className="psg-card-caption">Add milestones and tasks yourself</span>
                <span className="psg-card-go" aria-hidden="true"><ChevronRightGlyph size={20} /></span>
              </Choice>
              <Choice
                className="psg-card"
                selected={mode === "copy"}
                disabled={sources.length === 0}
                onSelect={() => onChange(value?.mode === "copy" ? value : { mode: "copy", sourceProjectId: null, name: "" })}
              >
                <span className="psg-icon"><FileGlyph size={26} /></span>
                <span className="psg-card-title">Copy a past project</span>
                <span className="psg-card-caption">{sources.length ? `${sources.length} to choose from` : "No past projects yet"}</span>
                <span className="psg-card-go" aria-hidden="true"><ChevronRightGlyph size={20} /></span>
              </Choice>
            </div>
          </section>

          <section aria-labelledby="psg-categories">
            <h2 id="psg-categories" className="psg-heading">Template categories</h2>
            {groups.length === 0 && <p className="psg-none">No templates are available yet.</p>}
            <div className="psg-categories">
              {groups.map(([type, list]) => (
                <button
                  key={type}
                  type="button"
                  className={"psg-card psg-category" + (mode !== "copy" && type === activeType ? " psg-card-open" : "")}
                  aria-pressed={mode !== "copy" && type === activeType}
                  onClick={() => {
                    setOpenType(type);
                    if (mode === "copy") onChange(null);
                  }}
                >
                  <span className="psg-icon"><CategoryIcon type={type} /></span>
                  <span className="psg-card-title">{type}</span>
                  <span className="psg-card-caption">{list.length} {list.length === 1 ? "template" : "templates"}</span>
                  <span className="psg-card-go" aria-hidden="true"><ChevronRightGlyph size={20} /></span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <section className="psg-panel" aria-label={mode === "copy" ? "Past projects" : `${activeType ?? "Template"} templates`}>
          {mode === "copy" ? (
            <>
              <h2 className="psg-panel-title">Copy a past project</h2>
              <input
                className="psg-search"
                type="search"
                placeholder="Search by project, client or type"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <ul className="psg-list psg-sources">
                {visibleSources.map((s) => {
                  const pick = { mode: "copy", sourceProjectId: s.projectId, name: s.name, projectType: s.projectType };
                  const chosen = value?.sourceProjectId === s.projectId;
                  return (
                    <li key={s.projectId}>
                      <Choice className="psg-row" selected={chosen} onSelect={() => onChange(pick)} onOpen={() => open(pick)} radio={false}>
                        <span className="psg-row-text">
                          <span className="psg-row-title">{s.name}</span>
                          <span className="psg-row-caption">
                            {[s.projectType, s.clientName, s.status].filter(Boolean).join(" · ")} · {s.milestoneCount} milestones, {s.taskCount} tasks
                          </span>
                        </span>
                        <span className="psg-row-mark" aria-hidden="true">{chosen ? "✓" : <ChevronRightGlyph size={18} />}</span>
                      </Choice>
                    </li>
                  );
                })}
                {visibleSources.length === 0 && <li className="psg-none">No project matches that search.</li>}
              </ul>
              <p className="psg-note">
                Only the milestone and task names, who handles planning tasks, and the order are copied, with dates
                moved onto your new project's dates. Progress, photos, documents, assignments, tickets, expenses,
                receipts, notes and the BOM are never copied.
              </p>
            </>
          ) : (
            <>
              <h2 className="psg-panel-title">{activeType ? `${activeType} templates` : "Templates"}</h2>
              <ul className="psg-list" role="radiogroup" aria-label={activeType ?? "Templates"}>
                {activeList.map((t) => {
                  const chosen = value?.mode === "template" && value.templateId === t.templateId;
                  return (
                    <li key={t.templateId}>
                      <Choice
                        className="psg-row"
                        selected={chosen}
                        onSelect={() => onChange(templateChoice(t))}
                        onOpen={() => open(templateChoice(t))}
                      >
                        <span className="psg-icon"><CategoryIcon type={t.projectType} /></span>
                        <span className="psg-row-text">
                          <span className="psg-row-title">{SIZE_TITLE[t.size] || t.name}</span>
                          <span className="psg-row-caption">{t.milestoneCount} milestones · {t.defaultTaskCount} tasks</span>
                          {t.description && <span className="psg-row-desc">{t.description}</span>}
                        </span>
                        <span className="psg-row-mark" aria-hidden="true">{chosen ? "✓" : <ChevronRightGlyph size={18} />}</span>
                      </Choice>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      </div>

      <div className="psg-actions">
        <span className="psg-picked"><span>Selected:</span> <strong>{pickedLabel}</strong></span>
        {hasDetails && (
          <Button type="button" variant="secondary" onClick={() => setShowSummary(true)}>View summary</Button>
        )}
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="button" disabled={!canContinue} onClick={() => onNext()}>Next →</Button>
      </div>

      {showSummary && hasDetails && (
        <TemplateSummaryDialog
          value={value}
          template={pickedTemplate}
          onClose={() => setShowSummary(false)}
          onUse={() => { setShowSummary(false); onNext(); }}
        />
      )}
    </div>
  );
}

// A choice: one click selects, two quick clicks open, Enter on the chosen one opens.
function Choice({ selected, onSelect, onOpen, className, disabled = false, radio = true, children }) {
  const handleClick = useDoubleTap(onSelect, onOpen);
  return (
    <button
      type="button"
      {...(radio ? { role: "radio", "aria-checked": selected } : { "aria-pressed": selected })}
      disabled={disabled}
      className={`${className} ${selected ? `${className}-selected` : ""}`}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" && selected && onOpen) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {children}
    </button>
  );
}
