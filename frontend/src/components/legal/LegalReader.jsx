import { useEffect, useRef, useState } from "react";
import { ArrowRightIcon, HighlightIcon } from "./LegalIcons";
import "./LegalReader.css";

// Shared by the "Before you continue" screen and the public /legal page.
// The text comes from GET /api/legal (backend/src/lib/legalTerms.js).

const DATE = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "long", day: "numeric" });

export function formatEffectiveDate(isoDate) {
  return isoDate ? DATE.format(new Date(`${isoDate}T00:00:00`)) : "";
}

// "3. Your account" -> { num: "3", label: "Your account" }
function splitHeading(heading) {
  const m = /^(\d+)\.\s*(.*)$/.exec(heading);
  return m ? { num: m[1], label: m[2] } : { num: "", label: heading };
}

const sectionId = (docId, i) => `legal-${docId}-${i + 1}`;

/** "At a glance": short plain-language points above the full text. */
export function LegalHighlights({ items }) {
  if (!items?.length) return null;
  return (
    <section className="legal-glance" aria-labelledby="legal-glance-title">
      <h2 id="legal-glance-title" className="legal-glance-title">
        At a glance
      </h2>
      <ul className="legal-glance-grid">
        {items.map((h) => (
          <li key={h.id} className="legal-glance-card">
            <span className="legal-glance-icon">
              <HighlightIcon name={h.icon} />
            </span>
            <div>
              <p className="legal-glance-card-title">{h.title}</p>
              <p className="legal-glance-card-text">{h.text}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="legal-glance-note">
        This summary is here to help. The full text below is what you agree to.
      </p>
    </section>
  );
}

/**
 * Tabs (Terms of Use / Privacy Notice), a section list that follows the
 * reader, and the document itself. The page scrolls, not a box inside it.
 */
export function LegalReader({ data, docId, onDocChange }) {
  const doc = data.documents.find((d) => d.id === docId) || data.documents[0];
  const docIndex = data.documents.indexOf(doc);
  const nextDoc = data.documents[docIndex + 1];
  const [activeIndex, setActiveIndex] = useState(0);
  const readerRef = useRef(null);

  // Highlight the section currently at the top of the screen.
  useEffect(() => {
    setActiveIndex(0);
    if (typeof IntersectionObserver === "undefined") return undefined;
    const nodes = doc.sections.map((_, i) => document.getElementById(sectionId(doc.id, i))).filter(Boolean);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const top = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        setActiveIndex(nodes.indexOf(top.target));
      },
      { rootMargin: "-96px 0px -60% 0px" }
    );
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [doc]);

  function goToSection(i) {
    document.getElementById(sectionId(doc.id, i))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function switchDoc(id) {
    if (id === doc.id) return;
    onDocChange(id);
    readerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="legal-reader" ref={readerRef} aria-label="Terms of Use and Privacy Notice">
      <div className="legal-tabs" role="tablist" aria-label="Documents">
        {data.documents.map((d) => (
          <button
            key={d.id}
            type="button"
            role="tab"
            id={`legal-tab-${d.id}`}
            aria-selected={d.id === doc.id}
            aria-controls="legal-doc-panel"
            className={"legal-tab" + (d.id === doc.id ? " is-active" : "")}
            onClick={() => switchDoc(d.id)}
          >
            {d.title}
            <span className="legal-tab-count">{d.sections.length}</span>
          </button>
        ))}
      </div>

      <div className="legal-reader-body">
        <nav className="legal-toc" aria-label={`${doc.title} sections`}>
          <p className="legal-toc-title">On this page</p>
          <ol>
            {doc.sections.map((s, i) => {
              const { num, label } = splitHeading(s.heading);
              return (
                <li key={s.heading}>
                  <button
                    type="button"
                    className={"legal-toc-link" + (i === activeIndex ? " is-active" : "")}
                    aria-current={i === activeIndex ? "true" : undefined}
                    onClick={() => goToSection(i)}
                  >
                    <span className="legal-toc-num">{num}</span>
                    <span>{label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <article
          id="legal-doc-panel"
          role="tabpanel"
          aria-labelledby={`legal-tab-${doc.id}`}
          className="legal-article"
        >
          <label className="legal-jump">
            <span>Jump to section</span>
            <select value={activeIndex} onChange={(e) => goToSection(Number(e.target.value))}>
              {doc.sections.map((s, i) => (
                <option key={s.heading} value={i}>
                  {s.heading}
                </option>
              ))}
            </select>
          </label>

          <h2 className="legal-article-title">{doc.title}</h2>

          {doc.sections.map((s, i) => {
            const { num, label } = splitHeading(s.heading);
            return (
              <section key={s.heading} id={sectionId(doc.id, i)} className="legal-section">
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

          <div className="legal-article-end">
            {nextDoc ? (
              <button type="button" className="legal-next" onClick={() => switchDoc(nextDoc.id)}>
                <span>
                  <span className="legal-next-label">Next</span>
                  <span className="legal-next-title">{nextDoc.title}</span>
                </span>
                <ArrowRightIcon />
              </button>
            ) : (
              <p className="legal-end-note">End of the {doc.title}.</p>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}

/** Grey placeholder blocks while the text loads. */
export function LegalSkeleton() {
  return (
    <div className="legal-skeleton" aria-busy="true" aria-label="Loading the terms">
      <div className="legal-skeleton-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="legal-skeleton-card" />
        ))}
      </div>
      <div className="legal-skeleton-block" />
    </div>
  );
}
