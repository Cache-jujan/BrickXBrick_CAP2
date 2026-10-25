import { useState } from "react";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { COST_CATEGORIES, MAX_ESCALATION_PCT } from "../../utils/costCategories";
import { useLocale } from "../../i18n/LocaleProvider";
import "./BudgetJustification.css";

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Adviser item 6: the BOM must justify the WHOLE budget. Shows the BOM total
 * split by type of cost, the price agreed with the client, the escalation
 * allowance for construction-year price increases, and the Target Budget the
 * project gets when the BOM is approved.
 *
 * byCategory   { category: amount } from the current (possibly unsaved) BOM
 * subtotal     the BOM total
 * statedTotal  the signed total in the client's file, or null
 * ratePct      escalation allowance in percent, as typed ("5")
 */
export function BudgetJustification({
  byCategory,
  subtotal,
  statedTotal,
  ratePct,
  note,
  editing,
  onRateChange,
  onNoteChange,
  onAddCost,
  rateError,
}) {
  const { t, tv } = useLocale();
  const [adding, setAdding] = useState(false);
  const [cost, setCost] = useState({ category: "Professional Fees", description: "", amount: "" });

  const used = COST_CATEGORIES.filter((c) => Number(byCategory[c] || 0) > 0);
  const unused = COST_CATEGORIES.filter((c) => !used.includes(c));
  const contractPrice = statedTotal !== null && statedTotal > 0 ? round2(statedTotal) : round2(subtotal);
  const rate = Number(ratePct);
  const rateValid = ratePct !== "" && Number.isFinite(rate) && rate >= 0 && rate <= MAX_ESCALATION_PCT;
  const allowance = rateValid ? round2(contractPrice * (rate / 100)) : 0;
  const target = round2(contractPrice + allowance);
  const priceDiffers = statedTotal !== null && Math.abs(statedTotal - subtotal) > 0.005;

  const amount = Number(cost.amount);
  const costValid = cost.description.trim().length > 1 && Number.isFinite(amount) && amount > 0;

  function addCost(e) {
    e.preventDefault();
    if (!costValid) return;
    onAddCost({ category: cost.category, description: cost.description.trim(), amount: round2(amount) });
    setCost({ category: cost.category, description: "", amount: "" });
    setAdding(false);
  }

  return (
    <section className="budget-just" aria-labelledby="budget-just-title">
      <div className="budget-just-head">
        <div>
          <h2 id="budget-just-title" className="budget-just-title">{t("bomjust.title")}</h2>
          <p className="budget-just-lead">{t("bomjust.lead")}</p>
        </div>
        {editing && !adding && (
          <Button variant="secondary" className="btn-sm" onClick={() => setAdding(true)}>
            {t("bomjust.add_other")}
          </Button>
        )}
      </div>

      {editing && adding && (
        <form className="budget-just-add" onSubmit={addCost} noValidate>
          <label className="field">
            <span className="field-label">{t("bomjust.type_of_cost")}</span>
            <select
              className="field-control"
              value={cost.category}
              onChange={(e) => setCost((c) => ({ ...c, category: e.target.value }))}
            >
              {COST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {tv("costcat", c)} ({tv("costhint", c)})
                </option>
              ))}
            </select>
          </label>
          <Field
            label={t("submit.description")}
            required
            placeholder={t("bomjust.desc_placeholder")}
            maxLength={150}
            value={cost.description}
            onChange={(e) => setCost((c) => ({ ...c, description: e.target.value }))}
          />
          <Field
            label={t("bomjust.amount_label")}
            required
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={cost.amount}
            onChange={(e) => setCost((c) => ({ ...c, amount: e.target.value }))}
          />
          <div className="budget-just-add-actions">
            <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!costValid}>
              {t("bomjust.add_to_bom")}
            </Button>
          </div>
          <p className="budget-just-hint">
            {t("bomjust.add_hint")}
            {statedTotal !== null && ` ${t("bomjust.add_hint_signed")}`}
          </p>
        </form>
      )}

      <div className="table-scroll">
        <table className="budget-just-table">
          <thead>
            <tr>
              <th>{t("bomjust.type_of_cost")}</th>
              <th className="num">{t("dashboard.amount")}</th>
              <th className="num">{t("bomjust.col_share")}</th>
            </tr>
          </thead>
          <tbody>
            {used.map((c) => {
              const value = Number(byCategory[c] || 0);
              const share = subtotal > 0 ? (value / subtotal) * 100 : 0;
              return (
                <tr key={c}>
                  <td>
                    {tv("costcat", c)}
                    <span className="budget-just-hintcell"> · {tv("costhint", c)}</span>
                  </td>
                  <td className="num">{PESO.format(value)}</td>
                  <td className="num">{share.toFixed(1)}%</td>
                </tr>
              );
            })}
            {used.length === 0 && (
              <tr>
                <td colSpan={3} className="budget-just-muted">{t("bomjust.no_costs")}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="budget-just-subtotal">
              <td>{t("bomjust.bom_total")}</td>
              <td className="num">{PESO.format(subtotal)}</td>
              <td className="num">100%</td>
            </tr>
            {priceDiffers && (
              <tr>
                <td>
                  {t("bomjust.price_agreed")}
                  <span className="budget-just-hintcell"> · {t("bomjust.signed_total")}</span>
                </td>
                <td className="num">{PESO.format(contractPrice)}</td>
                <td />
              </tr>
            )}
            <tr>
              <td>
                <span className="budget-just-rate">
                  {t("bomjust.escalation")}
                  {editing ? (
                    <span className="budget-just-rate-input">
                      <input
                        className={"bom-input num" + (rateError || (ratePct !== "" && !rateValid) ? " bom-input-error" : "")}
                        type="number"
                        min="0"
                        max={MAX_ESCALATION_PCT}
                        step="0.5"
                        value={ratePct}
                        aria-label={t("bomjust.escalation_aria")}
                        onChange={(e) => onRateChange(e.target.value)}
                      />
                      %
                    </span>
                  ) : (
                    <span className="budget-just-hintcell"> · {rateValid ? rate : 0}%</span>
                  )}
                </span>
                <span className="budget-just-hintcell budget-just-block">
                  {t("bomjust.escalation_help")}
                </span>
              </td>
              <td className="num">{PESO.format(allowance)}</td>
              <td />
            </tr>
            <tr className="budget-just-target">
              <td>{t("bomjust.target_budget")}</td>
              <td className="num">{PESO.format(target)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {editing ? (
        <Field
          label={t("bomjust.note_label")}
          placeholder={t("bomjust.note_placeholder")}
          maxLength={500}
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
        />
      ) : (
        note && <p className="budget-just-note">{t("bomjust.note_prefix", { note })}</p>
      )}

      <p className="budget-just-foot">
        {t("bomjust.foot")}
        {unused.length > 0 && ` ${t("bomjust.foot_unused", { list: unused.map((c) => tv("costcat", c)).join(", ") })}`}
      </p>
    </section>
  );
}
