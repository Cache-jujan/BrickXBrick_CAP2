import { useLocale } from "../../i18n/LocaleProvider";

const SHOWN = 3;

/**
 * The line next to a greyed-out Submit button: why it is greyed out. Lists what is still missing
 * (the first few, then "+N more"); once nothing is missing it shows the normal note instead.
 */
export function SubmitBlockers({ gaps, note }) {
  const { t } = useLocale();
  if (!gaps || gaps.length === 0) return note ? <p>{note}</p> : null;
  const shown = gaps.slice(0, SHOWN);
  const more = gaps.length - shown.length;
  return (
    <div className="xp-blockers" role="status" aria-live="polite">
      <strong>{t("gap.title")}</strong>
      <ul>
        {shown.map((label) => <li key={label}>{label}</li>)}
        {more > 0 && <li className="xp-blockers-more">{t("gap.more", { count: more })}</li>}
      </ul>
    </div>
  );
}
