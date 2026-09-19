import { useState } from "react";
import { verifyExpense } from "../../api/blockchainApi";
import { extractErrorMessage } from "../../api/client";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Banner } from "../../components/ui/Banner";

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
      const data = await verifyExpense(expenseId);
      setResult(data);
    } catch (err) {
      setError(extractErrorMessage(err, "Verification failed."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h1>Blockchain Audit Verification</h1>
      <Card style={{ marginTop: 16 }}>
        <form onSubmit={handleVerify}>
          <Field
            label="Expense ID"
            required
            placeholder="Paste expenseID"
            value={expenseId}
            onChange={(e) => setExpenseId(e.target.value)}
          />
          <Button type="submit" disabled={loading}>
            {loading ? "Verifying…" : "Verify Record"}
          </Button>
        </form>

        {error && <Banner tone="error" title={error} />}

        {result && (
          <div style={{ marginTop: 16 }}>
            {result.verified ? (
              <Banner tone="info" title="✅ Record Verified — No Tampering Detected">
                Tx Hash: {result.txHash} · Block #{result.blockNumber}
              </Banner>
            ) : (
              <Banner tone="error" title="⚠️ Tamper Alert">
                {result.message}
              </Banner>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}