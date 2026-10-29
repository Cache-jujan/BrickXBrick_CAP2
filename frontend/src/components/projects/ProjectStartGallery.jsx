import { useMemo, useRef, useState } from "react";
import { Button } from "../ui/Button";
import "./ProjectStartGallery.css";

// First screen of "New project", laid out like the New screen in Word: a row
// of tiles. Blank sheet comes first and is selected, then copying a past
// project, then one tile per template. A single click chooses a tile; Next (or a
// double-click / double-tap, or Enter on the chosen tile) opens it, like Word.
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

export function ProjectStartGallery({ templates, sources, value, onChange, onNext, onCancel }) {
  const [search, setSearch] = useState("");
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

  const visibleSources = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? sources.filter((s) => `${s.name} ${s.clientName} ${s.projectType}`.toLowerCase().includes(q))
      : sources;
  }, [sources, search]);

  const pickedTemplate = mode === "template" ? templates.find((t) => t.templateId === value.templateId) : null;

  const pickedLabel =
    mode === "template" ? `Selected: ${value.name}`
    : mode === "copy" ? (value?.sourceProjectId ? `Selected: ${value.name}` : "Choose a project to copy")
    : "Selected: Blank project";

  // Choose this starting point and go straight to the next step.
  function open(next) {
    onChange(next);
    onNext(next);
  }

  const canContinue = mode === "blank" || mode === "template" || (mode === "copy" && value?.sourceProjectId);

  return (
    <div className="psg">
      <p className="psg-lead">
        Start with an empty project, or begin from a template or a past project. A template only fills in
        milestones and tasks to save typing. Dates are worked out from your project dates, and everything can
        still be edited afterwards.
      </p>
      <p className="psg-tip">Tip: double-click (or double-tap) a tile to open it right away.</p>

      <div className="psg-scroll">

      <section aria-labelledby="psg-start">
        <h2 id="psg-start" className="psg-heading">Start</h2>
        <div className="psg-row" role="radiogroup" aria-label="How to start">
          <Tile
            selected={mode === "blank"}
            onSelect={() => onChange(null)}
            onOpen={() => open(null)}
            title="Blank project"
            caption="Add milestones and tasks yourself"
            thumb={<span className="psg-plus" aria-hidden="true">+</span>}
          />
          <Tile
            selected={mode === "copy"}
            onSelect={() => onChange(value?.mode === "copy" ? value : { mode: "copy", sourceProjectId: null, name: "" })}
            title="Copy a past project"
            caption={sources.length ? `${sources.length} to choose from` : "No past projects yet"}
            disabled={sources.length === 0}
            thumb={<Lines count={5} stacked />}
          />
        </div>
      </section>

      {mode === "copy" && (
        <section className="psg-copy" aria-label="Choose the project to copy">
          <input
            className="psg-search"
            type="search"
            placeholder="Search by project, client or type"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ul className="psg-sources">
            {visibleSources.map((s) => {
              const pick = { mode: "copy", sourceProjectId: s.projectId, name: s.name, projectType: s.projectType };
              return (
                <li key={s.projectId}>
                  <SourceRow
                    source={s}
                    chosen={value?.sourceProjectId === s.projectId}
                    onSelect={() => onChange(pick)}
                    onOpen={() => open(pick)}
                  />
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
        </section>
      )}

      <section aria-labelledby="psg-templates">
        <h2 id="psg-templates" className="psg-heading">Templates</h2>
        {groups.length === 0 && <p className="psg-none">No templates are available yet.</p>}
        {groups.map(([type, list]) => (
            <div key={type} className="psg-group">
              <h3 className="psg-type">{type}</h3>
              <div className="psg-row" role="radiogroup" aria-label={type}>
                {list.map((t) => (
                  <Tile
                    key={t.templateId}
                    selected={value?.mode === "template" && value.templateId === t.templateId}
                    onSelect={() => onChange({ mode: "template", templateId: t.templateId, name: t.name, projectType: t.projectType })}
                    onOpen={() => open({ mode: "template", templateId: t.templateId, name: t.name, projectType: t.projectType })}
                    title={t.size === "custom" ? "Custom" : t.size === "small" ? "Small" : "Large"}
                    caption={`${t.milestoneCount} milestones · ${t.defaultTaskCount} tasks`}
                    description={t.description}
                    thumb={<Lines count={t.size === "large" ? 7 : t.size === "small" ? 4 : 5} />}
                  />
                ))}
              </div>
            </div>
        ))}
        {pickedTemplate && (
          <div className="psg-describe" role="status">
            <strong>{pickedTemplate.projectType} · {pickedTemplate.size === "custom" ? "Custom" : pickedTemplate.size === "small" ? "Small" : "Large"}</strong>
            <p>{pickedTemplate.description || "No description has been written for this template yet."}</p>
          </div>
        )}
      </section>
      </div>

      <div className="psg-actions">
        <span className="psg-picked">{pickedLabel}</span>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="button" disabled={!canContinue} onClick={() => onNext()}>Next →</Button>
      </div>
    </div>
  );
}

function SourceRow({ source, chosen, onSelect, onOpen }) {
  const handleClick = useDoubleTap(onSelect, onOpen);
  return (
    <button
      type="button"
      className={`psg-source ${chosen ? "psg-source-selected" : ""}`}
      aria-pressed={chosen}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" && chosen) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <strong>{source.name}</strong>
      <span>
        {[source.projectType, source.clientName, source.status].filter(Boolean).join(" · ")} · {source.milestoneCount} milestones, {source.taskCount} tasks
      </span>
    </button>
  );
}

function Tile({ selected, onSelect, onOpen, title, caption, description, thumb, disabled = false }) {
  const handleClick = useDoubleTap(onSelect, onOpen);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      className={`psg-tile ${selected ? "psg-tile-selected" : ""}`}
      onClick={handleClick}
      onKeyDown={(e) => {
        // Enter on the chosen tile opens it; on any other tile it just chooses it.
        if (e.key === "Enter" && selected && onOpen) {
          e.preventDefault();
          onOpen();
        }
      }}
      title={description || undefined}
    >
      <span className="psg-thumb" aria-hidden="true">{thumb}</span>
      <span className="psg-check" aria-hidden="true">✓</span>
      <span className="psg-tile-title">{title}</span>
      <span className="psg-tile-caption">{caption}</span>
    </button>
  );
}

// A tiny page with a few lines on it, so tiles read like documents.
function Lines({ count, stacked = false }) {
  return (
    <span className={`psg-lines ${stacked ? "psg-lines-stacked" : ""}`}>
      {Array.from({ length: count }, (_, i) => (
        <i key={i} style={{ width: `${88 - ((i * 17) % 38)}%` }} />
      ))}
    </span>
  );
}
