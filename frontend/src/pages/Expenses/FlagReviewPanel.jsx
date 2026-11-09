import { Badge } from "../../components/ui/Badge";
import { Banner } from "../../components/ui/Banner";
import { flagLabel } from "../../utils/plainLanguage";
import { useLocale } from "../../i18n/LocaleProvider";

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Plain-language reason for a flag type, or "" when there is no translation for it. */
function whyText(t, flagType) {
  const key = `flagx.why.${String(flagType).toLowerCase()}`;
  const text = t(key);
  return text === key ? "" : text;
}

const num = (value) => (value == null || value === "" ? null : Number(value));

/** The other projects sharing one split receipt, with their amounts. Shown for any expense that has siblings. */
export function SplitSiblings({ siblings }) {
  const { t } = useLocale();
  if (!siblings || siblings.length === 0) return null;
  return (
    <section className="exp-section">
      <h3 className="exp-section-title">{t("flagx.split_title")}</h3>
      <table className="exp-mini-table">
        <thead>
          <tr>
            <th>{t("nav.project")}</th>
            <th className="exp-num">{t("dashboard.amount")}</th>
            <th>{t("dashboard.status")}</th>
          </tr>
        </thead>
        <tbody>
          {siblings.map((s) => (
            <tr key={s.expenseId}>
              <td>{s.projectName}</td>
              <td className="exp-num">{PESO.format(s.amount)}</td>
              <td><Badge status={s.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * What a GM/PM needs to decide on a flagged expense: why each flag was raised, the request next to
 * the receipt, the other projects sharing the receipt, and the earlier expense a duplicate points at.
 * `expense` is a row from GET /api/expenses/flagged.
 */
export function FlagReviewPanel({ expense, flags, showEffect }) {
  const { t, tv, formatDate } = useLocale();
  const ticket = expense.ticket;
  const siblings = expense.siblings ?? [];
  const duplicate = expense.duplicateof;

  const lines = typeof expense.lineitems === "string" ? safeParse(expense.lineitems) : expense.lineitems ?? [];
  const receiptMaterial = lines.map((l) => l.description).filter(Boolean).join(", ");

  return (
    <div className="flag-review">
      <Banner tone="warning" title={t("expenses.flagged_title")}>
        <ul className="expenses-flag-list">
          {flags.map((f, i) => (
            <li key={i}>
              <strong>{flagLabel(f.flagType, tv)}.</strong> {whyText(t, f.flagType) || f.reason}
              {whyText(t, f.flagType) && f.reason ? <div className="flag-review-detail">{f.reason}</div> : null}
            </li>
          ))}
        </ul>
        {showEffect ? <p className="flag-review-effect">{t("flagx.effect")}</p> : null}
      </Banner>

      {ticket && (
        <section className="flag-review-block">
          <h3 className="flag-review-title">{t("flagx.compare_title")}</h3>
          <table className="flag-review-table">
            <thead>
              <tr>
                <th>{t("flagx.col_item")}</th>
                <th>{t("flagx.col_asked")}</th>
                <th>{t("flagx.col_got")}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t("flagx.material")}</td>
                <td>{ticket.materialType || ticket.subject}</td>
                <td>{receiptMaterial || "—"}</td>
              </tr>
              <tr>
                <td>{t("flagx.quantity")}</td>
                <td>{[num(ticket.quantity), ticket.unit].filter((v) => v != null && v !== "").join(" ") || "—"}</td>
                <td>{num(expense.quantity) ?? "—"}</td>
              </tr>
              <tr>
                <td>{t("flagx.budget")}</td>
                <td>{num(ticket.approvedBudget) != null ? PESO.format(ticket.approvedBudget) : "—"}</td>
                <td>{PESO.format(expense.amount)}</td>
              </tr>
              <tr>
                <td>{t("flagx.store")}</td>
                <td>{ticket.vendorName || "—"}</td>
                <td>{expense.vendorname || "—"}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      <SplitSiblings siblings={siblings} />

      {duplicate && (
        <section className="flag-review-block">
          <h3 className="flag-review-title">{t("flagx.dup_title")}</h3>
          {duplicate.hidden ? (
            <p>{t("flagx.dup_hidden")}</p>
          ) : (
            <p>
              <strong>{duplicate.vendorName}</strong> · {PESO.format(duplicate.amount)} · {formatDate(duplicate.receiptDate)} · {duplicate.projectName}
              {duplicate.receiptImageURL ? (
                <>
                  {" "}
                  <a href={duplicate.receiptImageURL} target="_blank" rel="noreferrer">{t("expenses.view_receipt")}</a>
                </>
              ) : null}
            </p>
          )}
        </section>
      )}

      {expense.receiptimageurl && (
        <a className="flag-review-image" href={expense.receiptimageurl} target="_blank" rel="noreferrer" title={t("flagx.open_full")}>
          <img src={expense.receiptimageurl} alt={t("flagx.receipt_alt")} loading="lazy" />
        </a>
      )}
    </div>
  );
}

function safeParse(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
