import { useEffect, useState } from "react";

// Pieces shared by the two legal pages (TermsAcceptPage and LegalPage).

export function LegalBrand() {
  return (
    <span className="legal-brand">
      <img src="/images/logo.png" alt="" className="legal-brand-logo" />
      <span className="legal-brand-name">
        Brick <span className="legal-brand-x">x</span> Brick
      </span>
    </span>
  );
}

/** Thin bar under the header showing how far down the page you are. */
export function ReadingProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    function update() {
      const el = document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      setProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
    }
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div className="legal-progress" aria-hidden="true">
      <span style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
}

/** Rough reading time for both documents (about 200 words a minute). */
export function readingMinutes(data) {
  const words = data.documents
    .flatMap((d) => d.sections)
    .flatMap((s) => [...(s.paragraphs || []), ...(s.bullets || [])])
    .join(" ")
    .split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}
