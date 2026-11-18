import { useEffect, useRef, useState } from "react";
import { SUPPORTED_LOCALES, useLocale } from "./LocaleProvider";
import "./LanguageToggle.css";

const SHORT = { en: "EN", ceb: "CEB", fil: "FIL" };
// A language is shown in its own name, whatever language the page is in.
const OWN_NAME = { en: "English", ceb: "Cebuano", fil: "Filipino" };
const NAME_KEY = { en: "language.english", ceb: "language.bisaya", fil: "language.filipino" };

function GlobeIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 12h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 3c2.6 2.4 4 5.5 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.5-4-9s1.4-6.6 4-9Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A globe button for the top bar, next to the notification bell. It opens a
// small list of the three languages; picking one changes the language at once
// (the web has no confirmation step) and closes the list.
// Closes on a click elsewhere or Escape. Arrow keys, Home and End move between
// the languages, and only the current one is a Tab stop.
function LanguageIconMenu() {
  const { locale, setLanguage, t } = useLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const optionRefs = useRef([]);

  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function handleEscape(e) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  // When the list opens, focus goes to the current language so the keyboard starts there.
  useEffect(() => {
    if (open) optionRefs.current[SUPPORTED_LOCALES.indexOf(locale)]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when it opens, not when the language changes
  }, [open]);

  function choose(code) {
    setLanguage(code);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function handleOptionKeyDown(e, index) {
    const last = SUPPORTED_LOCALES.length - 1;
    let next = null;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    optionRefs.current[next]?.focus();
  }

  return (
    <div className="language-icon" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="language-icon-btn"
        aria-label={t("language.name")}
        title={t("language.name")}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <GlobeIcon />
      </button>
      {open && (
        <div className="language-icon-menu" role="radiogroup" aria-label={t("language.name")}>
          {SUPPORTED_LOCALES.map((code, index) => {
            const active = locale === code;
            return (
              <button
                key={code}
                ref={(node) => { optionRefs.current[index] = node; }}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={t(NAME_KEY[code])}
                tabIndex={active ? 0 : -1}
                className={`language-icon-option${active ? " is-active" : ""}`}
                onClick={() => choose(code)}
                onKeyDown={(e) => handleOptionKeyDown(e, index)}
              >
                <span>{OWN_NAME[code]}</span>
                {active && <CheckIcon />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// The EN / CEB / FIL box and the plain text links.
function LanguageOptions({ variant }) {
  const { locale, setLanguage, t } = useLocale();

  function option(code, className, label) {
    return (
      <button
        key={code}
        type="button"
        role="radio"
        aria-checked={locale === code}
        aria-label={t(NAME_KEY[code])}
        title={t(NAME_KEY[code])}
        className={`${className}${locale === code ? " is-active" : ""}`}
        onClick={() => setLanguage(code)}
      >
        {label}
      </button>
    );
  }

  if (variant === "segmented") {
    return (
      <div className="language-switch" role="radiogroup" aria-label={t("language.name")}>
        {SUPPORTED_LOCALES.map((code) => option(code, "language-switch-option", SHORT[code]))}
      </div>
    );
  }

  return (
    <div className="language-inline" role="radiogroup" aria-label={t("language.name")}>
      <div className="language-inline-options">
        {SUPPORTED_LOCALES.map((code) => option(code, "language-link", OWN_NAME[code]))}
      </div>
    </div>
  );
}

// Language switch. Each option is named in full for screen readers.
//   icon:   a globe button with a small list, for the top bar beside the bell
//   inline: plain text links, for the footer of the sign-in card
//   segmented (default): the EN / CEB / FIL box (not used by any page today)
export function LanguageToggle({ variant = "segmented" }) {
  if (variant === "icon") return <LanguageIconMenu />;
  return <LanguageOptions variant={variant} />;
}
