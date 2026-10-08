import { Link } from "react-router-dom";
import { ArrowLeftIcon } from "./icons";
import "./BackLink.css";

/**
 * "Back to …" navigation. Looks like a button (bordered, arrow icon) so it is
 * recognisable as a way back, instead of plain grey text.
 */
export function BackLink({ to, children, className = "" }) {
  return (
    <Link to={to} className={`back-link ${className}`}>
      <ArrowLeftIcon size={16} />
      <span>{children}</span>
    </Link>
  );
}
