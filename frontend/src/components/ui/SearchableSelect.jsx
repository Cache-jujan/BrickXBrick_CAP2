import { useId, useMemo, useRef, useState } from "react";
import "./Field.css";
import "./SearchableSelect.css";

// Every typed word must appear somewhere in the option's text (label, group,
// extra searchText), in any order; case and extra spaces are ignored.
export function filterOptions(options, query) {
  const words = String(query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return options;
  return options.filter((o) => {
    if (o.pinned) return true;
    const text = `${o.label} ${o.group ?? ""} ${o.searchText ?? ""}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/**
 * A dropdown you can type into. One box: click it, the list opens, and typing
 * narrows the list right there. Pick with the mouse, or with the arrow keys and
 * Enter; Escape closes it. It replaces a plain <select> and keeps the same
 * contract: `value` is the chosen option's value and `onChange(value)` gets the
 * new value (a string, not an event).
 *
 * options: [{ value, label, group?, searchText?, pinned? }]
 *   group   - options are listed under their group heading (consecutive).
 *   pinned  - always shown, even when it does not match what was typed
 *             (e.g. "Not in the BOM", "All projects").
 * An option with value "" is the "nothing chosen" row; it is pinned by default.
 */
export function SearchableSelect({
  label,
  required,
  missing = false,
  missingText = "",
  error,
  className = "",
  value,
  onChange,
  options,
  placeholder = "",
  searchPlaceholder = "",
  noMatchText = "",
  disabled = false,
  id,
  inline = false,
}) {
  const autoId = useId();
  const baseId = id || `ss-${autoId}`;
  const listId = `${baseId}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  const selected = options.find((o) => o.value === value) || null;
  const shown = useMemo(() => filterOptions(options, query), [options, query]);
  const typing = query.trim() !== "";
  // Rows that matched (not just pinned) — to know when to say "no match".
  const matched = shown.filter((o) => !o.pinned).length;

  function openList() {
    if (disabled) return;
    setQuery("");
    const at = options.findIndex((o) => o.value === value);
    setActive(at >= 0 ? at : 0);
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setQuery("");
  }
  function pick(option) {
    if (!option) return;
    onChange(option.value);
    close();
  }
  function onKeyDown(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return openList();
      if (shown.length === 0) return;
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % shown.length : (i - 1 + shown.length) % shown.length));
    } else if (e.key === "Enter") {
      // Enter must never submit the surrounding form from this box.
      e.preventDefault();
      if (open) pick(shown[Math.min(active, shown.length - 1)]);
      else openList();
    } else if (e.key === "Escape") {
      if (open) { e.preventDefault(); e.stopPropagation(); close(); }
    } else if (e.key === "Tab") {
      close();
    }
  }

  let lastGroup = null;
  const control = (
    <div className="ss-wrap">
      <input
        ref={inputRef}
        id={baseId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${baseId}-opt-${active}` : undefined}
        aria-required={required || undefined}
        autoComplete="off"
        disabled={disabled}
        className={`field-control ss-input ${error ? "field-control-error" : ""} ${missing ? "field-control-missing" : ""} ${!open && !selected ? "ss-placeholder" : ""}`}
        // Closed: show the chosen label. Open: show what is being typed.
        value={open ? query : selected ? selected.label : ""}
        placeholder={open ? searchPlaceholder || placeholder : placeholder}
        onFocus={openList}
        onClick={() => { if (!open) openList(); }}
        onChange={(e) => {
          const q = e.target.value;
          setQuery(q);
          // Highlight the first real match (not the "choose…" row) so Enter picks what was typed.
          const first = filterOptions(options, q).findIndex((o) => !o.pinned);
          setActive(first >= 0 ? first : 0);
          if (!open) setOpen(true);
        }}
        onBlur={close}
        onKeyDown={onKeyDown}
      />
      <span className="ss-caret" aria-hidden="true">▾</span>
      {open && (
        <ul id={listId} role="listbox" className="ss-list">
          {shown.map((o, i) => {
            const header = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group ?? null;
            return (
              <li key={`${o.value}-${i}`} role="presentation">
                {header && <div className="ss-group" role="presentation">{header}</div>}
                <div
                  id={`${baseId}-opt-${i}`}
                  role="option"
                  aria-selected={o.value === value}
                  className={`ss-option${i === active ? " ss-option-active" : ""}${o.value === value ? " ss-option-selected" : ""}`}
                  // mousedown (not click) so the input keeps focus and blur does not close first.
                  onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                  onMouseEnter={() => setActive(i)}
                >
                  {o.label}
                </div>
              </li>
            );
          })}
          {typing && matched === 0 && noMatchText && (
            <li role="presentation" className="ss-empty">{noMatchText.replace("{query}", query.trim())}</li>
          )}
        </ul>
      )}
    </div>
  );

  if (inline) return control;
  return (
    <div className={`field ${className}`}>
      {label && (
        <label className="field-label" htmlFor={baseId}>
          {label}
          {required && <span className="field-required"> *</span>}
          {missing && missingText && <span className="field-missing-tag">{missingText}</span>}
        </label>
      )}
      {control}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
