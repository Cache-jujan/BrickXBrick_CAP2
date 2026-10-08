import { AlertCircleIcon, AlertTriangleIcon, CheckCircleIcon, InfoIcon } from "./icons";
import "./Banner.css";

const ICONS = {
  error: AlertCircleIcon,
  warning: AlertTriangleIcon,
  info: InfoIcon,
  success: CheckCircleIcon,
};

/**
 * tone: "error" | "warning" | "info" | "success" | "empty"
 * Used for form-level errors, empty states, and inline notices.
 * Every tone except "empty" gets a leading icon so the meaning is clear
 * without relying on color alone.
 */
export function Banner({ tone = "info", title, children, action }) {
  const Icon = ICONS[tone];
  return (
    <div className={`banner banner-${tone}`} role={tone === "error" ? "alert" : undefined}>
      {Icon && (
        <span className="banner-icon">
          <Icon size={18} />
        </span>
      )}
      <div className="banner-content">
        {title && <p className="banner-title">{title}</p>}
        {children && <div className="banner-body">{children}</div>}
        {action && <div className="banner-action">{action}</div>}
      </div>
    </div>
  );
}
