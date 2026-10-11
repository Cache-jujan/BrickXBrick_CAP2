import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { ChainStatus } from "./ChainStatus";
import { humanizeVerifyError } from "../../utils/plainLanguage";
import "./ExpenseProtection.css";

const DATETIME = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

/**
 * The "Record protection" panel shown inside an approved expense's detail
 * row: current status, a "Check for changes" button (General Manager only,
 * once the record is secured), and the result of that check in plain words.
 *
 * result: the verify API response ({ verified, timestamp, txHash, blockNumber })
 *         or { verified: false, error: "..." } when the request itself failed.
 */
export function ExpenseProtection({ status, canCheck, checking, result, onCheck }) {
  const effectiveStatus = result && result.verified === false && !result.error ? "TamperDetected" : status;

  return (
    <section className="expense-protection" aria-label="Record protection">
      <div className="expense-protection-head">
        <ChainStatus status={effectiveStatus} withDescription />
        {canCheck && (status === "Confirmed" || status === "TamperDetected") && (
          <Button variant="secondary" className="btn-sm" disabled={checking} onClick={onCheck}>
            {checking ? "Checking…" : "Check for changes"}
          </Button>
        )}
      </div>

      {result && result.verified && (
        <Banner tone="success" title="No changes found">
          This expense still matches the copy secured
          {result.timestamp ? ` on ${DATETIME.format(new Date(result.timestamp))}` : " when it was approved"}.
        </Banner>
      )}

      {result && result.verified === false && result.error && (
        <Banner tone="warning" title="Couldn't run the check">
          {humanizeVerifyError(result.error)}
        </Banner>
      )}

      {result && result.verified === false && !result.error && (
        <Banner tone="error" title="This expense was changed after approval">
          Its details no longer match the secured copy. Your System Administrator has been notified
          and it now appears under Tamper Alerts.
        </Banner>
      )}
    </section>
  );
}
