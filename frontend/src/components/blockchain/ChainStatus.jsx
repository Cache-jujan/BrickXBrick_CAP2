import { chainStatusInfo } from "../../utils/plainLanguage";
import { useLocale } from "../../i18n/LocaleProvider";
import { CircleDashIcon, ClockIcon, ShieldAlertIcon, ShieldCheckIcon } from "../ui/icons";
import "./ChainStatus.css";

const ICONS = {
  secured: ShieldCheckIcon,
  pending: ClockIcon,
  changed: ShieldAlertIcon,
  none: CircleDashIcon,
};

/**
 * Plain-language pill for an expense's blockchainStatus.
 * `withDescription` adds the one-line explanation underneath, for detail
 * panels where there is room to say what the status means.
 */
export function ChainStatus({ status, withDescription = false }) {
  const { t } = useLocale();
  const info = chainStatusInfo(status);
  const Icon = ICONS[info.tone];
  const description = t(info.descriptionKey);
  const pill = (
    <span className={`chain-pill chain-pill-${info.tone}`} title={description}>
      <Icon size={15} />
      {t(info.labelKey)}
    </span>
  );
  if (!withDescription) return pill;
  return (
    <div className="chain-status-block">
      {pill}
      <p className="chain-status-description">{description}</p>
    </div>
  );
}
