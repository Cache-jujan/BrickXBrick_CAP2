import { useEffect, useState } from "react";
import { listMyExpenses } from "../../api/expensesApi";
import { extractErrorMessage } from "../../api/client";
import { Badge } from "../../components/ui/Badge";
import { Banner } from "../../components/ui/Banner";
import { Card } from "../../components/ui/Card";
import "./MyExpensesPage.css";

const PESO = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

const DATE = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function MyExpensesPage() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    listMyExpenses()
      .then(setExpenses)
      .catch((err) =>
        setError(extractErrorMessage(err, "Could not load your expenses."))
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="my-expenses-page">
      <div className="my-expenses-heading">
        <div>
          <p className="my-expenses-eyebrow">PURCHASER WORKSPACE</p>
          <h1>My Expenses</h1>
          <p className="my-expenses-subtitle">
            Track PM review decisions on your submitted receipts. Rejected
            expenses are corrected and resubmitted from the mobile app.
          </p>
        </div>
      </div>

      {error && <Banner tone="error" title={error} />}

      {!error && loading && (
        <p className="dashboard-loading">Loading your expenses...</p>
      )}

      {!error && !loading && expenses.length === 0 && (
        <Banner tone="empty" title="No expenses submitted yet">
          Your submitted receipts will appear here.
        </Banner>
      )}

      {!error && !loading && expenses.length > 0 && (
        <Card className="my-expenses-card">
          <div className="table-scroll">
            <table className="users-table my-expenses-table">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Amount</th>
                  <th>Receipt date</th>
                  <th>Status</th>
                  <th>Next step</th>
                </tr>
              </thead>

              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.expenseID}>
                    <td>
                      <strong>{expense.vendorName}</strong>
                      {expense.status === "Rejected" && expense.rejectionReason && (
                        <p className="my-expenses-reason">
                          <strong>PM note:</strong> {expense.rejectionReason}
                        </p>
                      )}
                    </td>

                    <td>{PESO.format(expense.amount)}</td>

                    <td>
                      {expense.receiptDate
                        ? DATE.format(new Date(expense.receiptDate))
                        : "-"}
                    </td>

                    <td>
                      <Badge status={expense.status} />
                    </td>

                    <td className="my-expenses-action-cell">
                      {expense.status === "Rejected" && (
                        <span className="my-expenses-waiting">
                          Correct and resubmit in the mobile app
                        </span>
                      )}
                      {expense.status === "Pending" && (
                        <span className="my-expenses-waiting">
                          Waiting for PM review
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}