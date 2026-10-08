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
