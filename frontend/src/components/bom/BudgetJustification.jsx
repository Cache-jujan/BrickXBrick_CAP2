import { useState } from "react";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { CATEGORY_HINTS, COST_CATEGORIES, MAX_ESCALATION_PCT } from "../../utils/costCategories";
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
          <h2 id="budget-just-title" className="budget-just-title">Budget justification</h2>
          <p className="budget-just-lead">Where the Target Budget goes, by type of cost.</p>
        </div>
        {editing && !adding && (
          <Button variant="secondary" className="btn-sm" onClick={() => setAdding(true)}>
            Add other cost
          </Button>
        )}
      </div>

      {editing && adding && (
        <form className="budget-just-add" onSubmit={addCost} noValidate>
          <label className="field">
            <span className="field-label">Type of cost</span>
            <select
              className="field-control"
              value={cost.category}
              onChange={(e) => setCost((c) => ({ ...c, category: e.target.value }))}
            >
              {COST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c} ({CATEGORY_HINTS[c]})
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Description"
            required
            placeholder="e.g. Structural engineer's fee"
            maxLength={150}
            value={cost.description}
            onChange={(e) => setCost((c) => ({ ...c, description: e.target.value }))}
          />
          <Field
            label="Amount (₱)"
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
              Cancel
            </Button>
            <Button type="submit" disabled={!costValid}>
              Add to BOM
            </Button>
          </div>
          <p className="budget-just-hint">
            Added as its own section with a fixed amount. Save the BOM to keep it.
            {statedTotal !== null &&
              " This BOM came from the client's signed file, so a cost added here isn't in the price they agreed to: the totals won't match until the client agrees to the new total."}
          </p>
        </form>
      )}

      <div className="table-scroll">
        <table className="budget-just-table">
          <thead>
            <tr>
              <th>Type of cost</th>
              <th className="num">Amount</th>
              <th className="num">Share</th>
            </tr>
          </thead>
          <tbody>
            {used.map((c) => {
              const value = Number(byCategory[c] || 0);
              const share = subtotal > 0 ? (value / subtotal) * 100 : 0;
              return (
                <tr key={c}>
                  <td>
                    {c}
                    <span className="budget-just-hintcell"> · {CATEGORY_HINTS[c]}</span>
                  </td>
                  <td className="num">{PESO.format(value)}</td>
                  <td className="num">{share.toFixed(1)}%</td>
                </tr>
              );
            })}
            {used.length === 0 && (
              <tr>
                <td colSpan={3} className="budget-just-muted">No costs yet.</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="budget-just-subtotal">
              <td>BOM total</td>
              <td className="num">{PESO.format(subtotal)}</td>
              <td className="num">100%</td>
            </tr>
            {priceDiffers && (
              <tr>
                <td>
                  Price agreed with the client
                  <span className="budget-just-hintcell"> · signed total in the file</span>
                </td>
                <td className="num">{PESO.format(contractPrice)}</td>
                <td />
              </tr>
            )}
            <tr>
              <td>
                <span className="budget-just-rate">
                  Escalation allowance
                  {editing ? (
                    <span className="budget-just-rate-input">
                      <input
                        className={"bom-input num" + (rateError || (ratePct !== "" && !rateValid) ? " bom-input-error" : "")}
                        type="number"
                        min="0"
                        max={MAX_ESCALATION_PCT}
                        step="0.5"
                        value={ratePct}
                        aria-label="Escalation allowance in percent"
                        onChange={(e) => onRateChange(e.target.value)}
                      />
                      %
                    </span>
                  ) : (
                    <span className="budget-just-hintcell"> · {rateValid ? rate : 0}%</span>
                  )}
                </span>
                <span className="budget-just-hintcell budget-just-block">
                  For price increases before construction starts (adviser: 5 to 6%).
                </span>
              </td>
              <td className="num">{PESO.format(allowance)}</td>
              <td />
            </tr>
            <tr className="budget-just-target">
              <td>Target Budget</td>
              <td className="num">{PESO.format(target)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {editing ? (
        <Field
          label="Note on the allowance (optional)"
          placeholder="e.g. Construction starts January 2027"
          maxLength={500}
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
        />
      ) : (
        note && <p className="budget-just-note">Allowance note: {note}</p>
      )}

      <p className="budget-just-foot">
        The client agrees to the price of the BOM; the allowance is the company&apos;s buffer and isn&apos;t
        added to that price.
        {unused.length > 0 && ` Not used in this BOM: ${unused.join(", ")}.`}
      </p>
    </section>
  );
}
