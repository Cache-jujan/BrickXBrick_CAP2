import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
        setError(
          extractErrorMessage(err, "Could not load your expenses.")
        )
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="my-expenses-page">
      <div className="my-expenses-heading">
        <div>
          <p className="my-expenses-eyebrow">
            PURCHASER WORKSPACE
          </p>

          <h1>My Expenses</h1>

          <p className="my-expenses-subtitle">
            Track review decisions and correct rejected expenses
            before sending them back to the PM queue.
          </p>
        </div>

        <Link to="/expenses/new" className="btn btn-primary">
          Submit Expense
        </Link>
      </div>

      {error && <Banner tone="error" title={error} />}

      {!error && loading && (
        <p className="dashboard-loading">
          Loading your expenses…
        </p>
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
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.expenseID}>
                    <td>
                      <strong>{expense.vendorName}</strong>

                      {expense.status === "Rejected" &&
                        expense.rejectionReason && (
                          <p className="my-expenses-reason">
                            <strong>PM note:</strong>{" "}
                            {expense.rejectionReason}
                          </p>
                        )}
                    </td>

                    <td>{PESO.format(expense.amount)}</td>

                    <td>
                      {expense.receiptDate
                        ? DATE.format(new Date(expense.receiptDate))
                        : "—"}
                    </td>

                    <td>
                      <Badge status={expense.status} />
                    </td>

                    <td className="my-expenses-action-cell">
                      {expense.status === "Rejected" && (
                        <Link
                          className="btn btn-secondary btn-small"
                          to={`/expenses/new?resubmit=${expense.expenseID}`}
                        >
                          Correct &amp; resubmit
                        </Link>
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
