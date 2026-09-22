import { useState } from "react";
import { verifyExpense } from "../../api/blockchainApi";
import { extractErrorMessage } from "../../api/client";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Banner } from "../../components/ui/Banner";
import "./VerifyExpensePage.css";

export function VerifyExpensePage() {
  const [expenseId, setExpenseId] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleVerify(e) {
    e.preventDefault();
    setError("");
    setResult(null);
    setLoading(true);
    try {
      setResult(await verifyExpense(expenseId.trim()));
    } catch (err) {
      setError(extractErrorMessage(err, "Verification failed."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="verify-page">
      <h1>Blockchain Audit Verification</h1>
      <p className="verify-subtitle">
        Recomputes an expense's hash and compares it with the value recorded on the blockchain.
      </p>
      <Card className="verify-card">
        <form onSubmit={handleVerify}>
          <Field
            label="Expense ID"
            required
            placeholder="Paste the expense ID"
            value={expenseId}
            onChange={(e) => setExpenseId(e.target.value)}
          />
          <Button type="submit" disabled={loading || !expenseId.trim()}>
            {loading ? "Verifying…" : "Verify Record"}
          </Button>
        </form>

        {error && <Banner tone="error" title={error} />}

        {result && (
          <div className="verify-result">
            {result.verified ? (
              <Banner tone="info" title="Record verified. No tampering detected.">
                Tx Hash: {result.txHash} · Block #{result.blockNumber}
              </Banner>
            ) : (
              <Banner tone="error" title="Tamper alert">
                {result.message}
              </Banner>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
