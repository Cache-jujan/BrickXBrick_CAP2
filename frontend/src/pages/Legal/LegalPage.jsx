import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getLegalDocuments } from "../../api/legalApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Banner } from "../../components/ui/Banner";
import {
  LegalHighlights,
  LegalReader,
  LegalSkeleton,
  formatEffectiveDate,
} from "../../components/legal/LegalReader";
import { PrintIcon } from "../../components/legal/LegalIcons";
import { LegalBrand, ReadingProgress, readingMinutes } from "./LegalChrome";
import "./LegalPages.css";

// /legal — Terms of Use and Privacy Notice, readable by anyone (linked from
// the login page and from the user menu). ?doc=privacy opens the Privacy tab.
export function LegalPage() {
  const { status } = useAuth();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const docId = params.get("doc") === "privacy" ? "privacy" : "terms";
  const signedIn = status === "authenticated";

  useEffect(() => {
    getLegalDocuments()
      .then(setData)
      .catch((err) => setError(extractErrorMessage(err, "Couldn't load the terms. Please try again.")));
  }, []);

  return (
    <div className="legal-page">
      <header className="legal-header">
        <div className="legal-header-inner">
          <Link to={signedIn ? "/" : "/login"} className="legal-brand-link" aria-label="Brick x Brick home">
            <LegalBrand />
          </Link>
          <div className="legal-header-actions">
            {data && (
              <button type="button" className="legal-text-btn legal-print" onClick={() => window.print()}>
                <PrintIcon /> Print
              </button>
            )}
            <Link to={signedIn ? "/" : "/login"} className="legal-back">
              {signedIn ? "Back to Brick x Brick" : "Back to sign in"}
            </Link>
          </div>
        </div>
        <ReadingProgress />
      </header>

      <main className="legal-main">
        <div className="legal-hero">
          <p className="legal-eyebrow">Legal</p>
          <h1>Terms &amp; Privacy</h1>
          <p className="legal-lede">
            How Brick x Brick may be used, and how your personal data is handled under the Data Privacy Act of
            2012 (RA 10173).
          </p>
          {data && (
            <p className="legal-meta">
              <span className="legal-chip">Version {data.version}</span>
              <span>Effective {formatEffectiveDate(data.effectiveDate)}</span>
              <span className="legal-meta-dot" aria-hidden="true">·</span>
              <span>About {readingMinutes(data)} min read</span>
            </p>
          )}
        </div>

        {error && <Banner tone="error" title={error} />}
        {!error && !data && <LegalSkeleton />}

        {data && (
          <>
            <LegalHighlights items={data.highlights} />
            <LegalReader
              data={data}
              docId={docId}
              onDocChange={(id) => setParams(id === "privacy" ? { doc: "privacy" } : {}, { replace: true })}
            />
          </>
        )}
      </main>
    </div>
  );
}
