// Small inline icons for UI primitives (banners, status pills, back links).
// Same approach as components/layout/icons.jsx: no icon-library dependency,
// stroke uses currentColor so each icon takes its parent's text color.

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export function ArrowLeftIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );
}

export function ShieldCheckIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" />
      <path d="m8.8 12.2 2.2 2.2 4.3-4.6" />
    </svg>
  );
}

export function ShieldAlertIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" />
      <path d="M12 8.5v4M12 15.8v.2" />
    </svg>
  );
}

export function ClockIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} {...base}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function CircleDashIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} {...base}>
      <circle cx="12" cy="12" r="8.5" strokeDasharray="3 3.2" />
    </svg>
  );
}

export function AlertTriangleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4M12 17v.2" />
    </svg>
  );
}

export function AlertCircleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.8v5M12 16.2v.2" />
    </svg>
  );
}

export function InfoIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.2M12 7.8v.2" />
    </svg>
  );
}

export function CheckCircleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.3 12.3 2.5 2.5 4.9-5.2" />
    </svg>
  );
}

export function SearchIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} {...base}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

export function EyeIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M9.5 5.2A10.9 10.9 0 0 1 12 5c7 0 11 7 11 7a17.7 17.7 0 0 1-3.5 4.3M6.2 6.6C3.5 8.3 1 12 1 12a17.5 17.5 0 0 0 5.2 5.6c1.6 1 3.5 1.7 5.8 1.7 1 0 2-.1 2.9-.4" />
    </svg>
  );
}
