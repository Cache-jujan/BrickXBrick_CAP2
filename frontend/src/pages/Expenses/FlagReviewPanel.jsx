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

/** A line-items value may arrive as an array or as a JSON string; always return an array. */
function parseItems(value) {
  return typeof value === "string" ? safeParse(value) : Array.isArray(value) ? value : [];
}

/** "Cement × 10", or just the name for a fee line with no quantity. */
function itemText(li) {
  const qty = num(li.quantity);
  return qty ? `${li.description} × ${qty}` : li.description;
}

/**
 * Every project sharing one split receipt: what each part bought, its amount and status, and the
 * receipt total. `current` is the part being reviewed (marked "This part"); `compact` hides the items
 * (used inside the approve/reject box). Shown for any expense that has siblings.
 */
export function SplitSiblings({ siblings, current, compact = false }) {
  const { t } = useLocale();
  if (!siblings || siblings.length === 0) return null;

  const parts = [
    ...(current ? [{ ...current, expenseId: "current", isCurrent: true }] : []),
    ...siblings,
  ];
  const total = parts.reduce((sum, p) => sum + (num(p.amount) ?? 0), 0);

  return (
    <section className="exp-section">
      <h3 className="exp-section-title">{t("flagx.split_title")}</h3>
      <table className="exp-mini-table exp-parts">
        <thead>
          <tr>
            <th>{t("nav.project")}</th>
            {!compact && <th>{t("expenses.items_title")}</th>}
            <th className="exp-num">{t("dashboard.amount")}</th>
            <th>{t("dashboard.status")}</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((p) => {
            const items = parseItems(p.lineItems).filter((li) => li?.description);
            return (
              <tr key={p.expenseId} className={p.isCurrent ? "exp-part-this" : undefined}>
                <td>
                  {p.projectName}
                  {p.isCurrent && <span className="exp-part-tag">{t("flagx.this_part")}</span>}
                  {p.ticketSubject && <span className="exp-part-sub">{p.ticketSubject}</span>}
                </td>
                {!compact && (
                  <td>
                    {items.length === 0 ? "—" : (
                      <ul className="exp-part-items">
                        {items.map((li, i) => <li key={i}>{itemText(li)}</li>)}
                      </ul>
                    )}
                  </td>
                )}
                <td className="exp-num">{PESO.format(p.amount)}</td>
                <td><Badge status={p.status} /></td>
              </tr>
            );
          })}
        </tbody>
        {current && (
          <tfoot>
            <tr className="exp-part-total">
              <td colSpan={compact ? 1 : 2}>{t("flagx.receipt_total")}</td>
              <td className="exp-num">{PESO.format(total)}</td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </section>
  );
}

/** The part being reviewed, in the same shape as a sibling, taken from an expense row. */
export function currentPartOf(expense, projectName) {
  return {
    projectName: projectName ?? expense.projectname ?? "—",
    amount: expense.amount,
    status: expense.status,
    quantity: expense.quantity,
    lineItems: expense.lineitems,
    ticketSubject: expense.ticketsubject ?? expense.ticket?.subject,
  };
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

      <SplitSiblings siblings={siblings} current={currentPartOf(expense)} />

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
