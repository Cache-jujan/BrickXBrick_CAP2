import { useEffect, useState } from "react";
import { listMyExpenses } from "../../api/expensesApi";
import { extractErrorMessage } from "../../api/client";
import { Badge } from "../../components/ui/Badge";
import { Banner } from "../../components/ui/Banner";
import { Card } from "../../components/ui/Card";
import { useLocale } from "../../i18n/LocaleProvider";
import "./MyExpensesPage.css";

const PESO = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

export function MyExpensesPage() {
  const { t, formatDate } = useLocale();
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    listMyExpenses()
      .then(setExpenses)
      .catch((err) =>
        setError(extractErrorMessage(err, t("errors.load_my_expenses")))
      )
      .finally(() => setLoading(false));
  }, [t]);

  return (
    <div className="my-expenses-page">
      <div className="my-expenses-heading">
        <div>
          <p className="my-expenses-eyebrow">{t("my_expenses.eyebrow")}</p>
          <h1>{t("nav.my_expenses")}</h1>
          <p className="my-expenses-subtitle">{t("my_expenses.subtitle")}</p>
        </div>
      </div>

      {error && <Banner tone="error" title={error} />}

      {!error && loading && (
        <p className="dashboard-loading">{t("my_expenses.loading")}</p>
      )}

      {!error && !loading && expenses.length === 0 && (
        <Banner tone="empty" title={t("my_expenses.none_title")}>
          {t("my_expenses.none_body")}
        </Banner>
      )}

      {!error && !loading && expenses.length > 0 && (
        <Card className="my-expenses-card">
          <div className="table-scroll">
            <table className="users-table my-expenses-table">
              <thead>
                <tr>
                  <th>{t("dashboard.vendor")}</th>
                  <th>{t("dashboard.amount")}</th>
                  <th>{t("my_expenses.receipt_date")}</th>
                  <th>{t("dashboard.status")}</th>
                  <th>{t("my_expenses.next_step")}</th>
                </tr>
              </thead>

              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.expenseID}>
                    <td>
                      <strong>{expense.vendorName}</strong>
                      {expense.status === "Rejected" && expense.rejectionReason && (
                        <p className="my-expenses-reason">
                          <strong>{t("my_expenses.pm_note")}</strong> {expense.rejectionReason}
                        </p>
                      )}
                    </td>

                    <td>{PESO.format(expense.amount)}</td>

                    <td>
                      {expense.receiptDate
                        ? formatDate(expense.receiptDate)
                        : "-"}
                    </td>

                    <td>
                      <Badge status={expense.status} />
                    </td>

                    <td className="my-expenses-action-cell">
                      {expense.status === "Rejected" && (
                        <span className="my-expenses-waiting">
                          {t("my_expenses.resubmit")}
                        </span>
                      )}
                      {expense.status === "Pending" && (
                        <span className="my-expenses-waiting">
                          {t("my_expenses.waiting")}
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