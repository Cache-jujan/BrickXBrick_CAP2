import "./Banner.css";

/**
 * tone: "error" | "empty" | "info"
 * Used for form-level errors, empty states, and inline notices.
 */
export function Banner({ tone = "info", title, children }) {
  return (
    <div className={`banner banner-${tone}`}>
      {title && <p className="banner-title">{title}</p>}
      {children && <p className="banner-body">{children}</p>}
    </div>
  );
}
