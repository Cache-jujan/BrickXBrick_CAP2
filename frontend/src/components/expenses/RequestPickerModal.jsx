import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { searchRequests, suggestRequests } from "../../utils/requestSearch";
import { useLocale } from "../../i18n/LocaleProvider";
import "./RequestPickerModal.css";

/**
 * "Match to a request": a searchable list of the open requests. It opens already narrowed to the
 * requests that look like the receipt line, and typing searches material, project and store
 * (part of a word is enough, any letter case).
 *
 * @param {{ line: {description: string}|null, requests: object[], onPick: (request: object) => void, onClose: () => void }} props
 *   `line` is the receipt line being matched; the picker is shown while it is not null.
 */
export function RequestPickerModal({ line, requests, onPick, onClose }) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  // A fresh start each time the picker opens for a line.
  useEffect(() => {
    setQuery("");
    setShowAll(false);
  }, [line]);

  const suggested = useMemo(() => suggestRequests(line?.description ?? "", requests), [line, requests]);
  if (!line) return null;

  const typing = query.trim().length > 0;
  const shown = typing ? searchRequests(query, requests) : showAll || !suggested.matched ? requests : suggested.requests;

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="modal request-picker" role="dialog" aria-modal="true" aria-labelledby="request-picker-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="request-picker-title" className="modal-title">{t("rv.requested_materials")}</h2>
        <p className="request-picker-line">{line.description}</p>

        <Field
          label={t("rv.search_label")}
          type="search"
          autoFocus
          value={query}
          placeholder={t("rv.search_hint")}
          onChange={(e) => setQuery(e.target.value)}
        />

        {!typing && suggested.matched && !showAll && (
          <p className="request-picker-hint">
            {t("rv.suggested_for", { line: line.description })}{" "}
            <button type="button" className="request-picker-link" onClick={() => setShowAll(true)}>{t("rv.show_all")}</button>
          </p>
        )}

        <ul className="request-picker-list">
          {shown.length === 0 && <li className="request-picker-empty">{t("rv.none")}</li>}
          {shown.map((request) => (
            <li key={request.ticketID}>
              <button type="button" className="request-picker-row" onClick={() => onPick(request)}>
                <strong>{request.materialType}</strong>
                <span>
                  {[request.projectName, request.vendorName, t("rv.left", { qty: request.remainingQuantity })].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
        </div>
      </div>
    </div>
  );
}
