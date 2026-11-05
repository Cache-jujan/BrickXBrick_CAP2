import { NavLink } from "react-router-dom";
import { useLocale } from "../../i18n/LocaleProvider";
import "./ExpenseModeBar.css";

// The three ways to put an expense in. Each has its own colour (set by the page's data-mode),
// icon and one-line purpose, so you can tell which one you are on without reading the page.
const ICON_PROPS = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

const ReceiptIcon = () => (
  <svg {...ICON_PROPS}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>
);
const SplitIcon = () => (
  <svg {...ICON_PROPS}><path d="M12 3v6" /><path d="M12 9c0 4-6 4-6 9" /><path d="M12 9c0 4 6 4 6 9" /><path d="m3 15 3 3 3-3M15 15l3 3 3-3" /></svg>
);
export const EXPENSE_MODES = [
  { id: "submit", to: "/expenses/new", labelKey: "nav.submit_expense", useKey: "mode.submit_use", Icon: ReceiptIcon },
  { id: "split", to: "/expenses/split", labelKey: "nav.split_receipt", useKey: "mode.split_use", Icon: SplitIcon },
];

/**
 * Top of the Submit expense and Split receipt pages: a big coloured title for the
 * page you are on, and a tab to jump to the other.
 *
 * @param {{ mode: "submit"|"split", role?: string }} props
 */
export function ExpenseModeBar({ mode, role }) {
  const { t } = useLocale();
  const current = EXPENSE_MODES.find((m) => m.id === mode) ?? EXPENSE_MODES[0];
  const { Icon } = current;

  return (
    <header className="mode-bar">
      <div className="mode-bar-title">
        <span className="mode-bar-icon"><Icon /></span>
        <div>
          <h1>{t(current.labelKey)}</h1>
          <p>{t(current.useKey)}</p>
        </div>
      </div>
      <nav className="mode-bar-tabs" aria-label={t("mode.nav_label")}>
        {EXPENSE_MODES.map((m) => (
          <NavLink
            key={m.id}
            to={m.to}
            end
            className={`mode-tab mode-tab-${m.id}${m.id === mode ? " mode-tab-on" : ""}`}
            aria-current={m.id === mode ? "page" : undefined}
          >
            <m.Icon />
            <span>{t(m.labelKey)}</span>
          </NavLink>
        ))}
      </nav>
      {role && <span className="mode-bar-role">{role}</span>}
    </header>
  );
}
