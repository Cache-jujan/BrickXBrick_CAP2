import "./Button.css";

/**
 * variant: "primary" | "secondary" | "ghost" | "danger"
 * All other props (onClick, type, disabled...) pass through.
 */
export function Button({ variant = "primary", children, className = "", ...rest }) {
  return (
    <button className={`btn btn-${variant} ${className}`} {...rest}>
      {children}
    </button>
  );
}
