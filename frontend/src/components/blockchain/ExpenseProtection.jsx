import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { ChainStatus } from "./ChainStatus";
import { humanizeVerifyError } from "../../utils/plainLanguage";
import { useLocale } from "../../i18n/LocaleProvider";
import "./ExpenseProtection.css";

const DATETIME_OPTIONS = { dateStyle: "medium", timeStyle: "short" };

/**
 * The "Record protection" panel shown inside an approved expense's detail
 * row: current status, a "Check for changes" button (General Manager only,
 * once the record is secured), and the result of that check in plain words.
 *
 * result: the verify API response ({ verified, timestamp, txHash, blockNumber })
 *         or { verified: false, error: "..." } when the request itself failed.
 */
export function ExpenseProtection({ status, canCheck, checking, result, onCheck }) {
  const { t, formatDate } = useLocale();
  const effectiveStatus = result && result.verified === false && !result.error ? "TamperDetected" : status;

  return (
    <section className="expense-protection" aria-label={t("nav.record_protection")}>
      <div className="expense-protection-head">
        <ChainStatus status={effectiveStatus} withDescription />
        {canCheck && (status === "Confirmed" || status === "TamperDetected") && (
          <Button variant="secondary" className="btn-sm" disabled={checking} onClick={onCheck}>
            {checking ? t("protection.checking") : t("protection.check")}
          </Button>
        )}
      </div>

      {result && result.verified && (
        <Banner tone="success" title={t("protection.no_changes")}>
          {result.timestamp
            ? t("protection.matches_on", { date: formatDate(result.timestamp, DATETIME_OPTIONS) })
            : t("protection.matches_approved")}
        </Banner>
      )}

      {result && result.verified === false && result.error && (
        <Banner tone="warning" title={t("protection.check_failed")}>
          {humanizeVerifyError(result.error, t)}
        </Banner>
      )}

      {result && result.verified === false && !result.error && (
        <Banner tone="error" title={t("protection.changed_title")}>
          {t("protection.changed_body")}
        </Banner>
      )}
    </section>
  );
}
